import { ethers, waffle, network, config } from 'hardhat'
import { expect } from 'chai'
import { Signer, utils, Contract, BigNumber } from 'ethers'
import ERC20Abi from '../helpers/erc20Abi.json'
import WhaleAddresses from '../helpers/whaleAddresses.json'
import { main as Assets } from '../helpers/assets'
import { SincoreSwap } from '../../typechain/SincoreSwap'
import { SincoreBestRateQuery } from '../../typechain/SincoreBestRateQuery'
import { ISincoreTradingRoute } from '../../typechain/ISincoreTradingRoute'
import { IERC20 } from '../../typechain/IERC20'
import '@openzeppelin/test-helpers'
import { UNISWAP_ROUTER_ADDRESS, SUSHISWAP_ROUTER_ADDRESS, WETH_ADDRESS } from '../constants'

const MAX_BEST_RATE_SPLIT_ROUTES_QUERY_GAS_LIMIT = 100000000 // 100M

describe('SincoreSwap', () => {
  let Sincore: SincoreSwap
  let uniswapRoute: ISincoreTradingRoute
  let sushiswapRoute: ISincoreTradingRoute
  let curveRoute: ISincoreTradingRoute
  let uniswapTokenEthTokenRoute: ISincoreTradingRoute
  let sushiswapTokenEthTokenRoute: ISincoreTradingRoute
  let SincoreBestRateQuery: SincoreBestRateQuery
  let dai: IERC20
  let usdc: IERC20
  let usdt: IERC20
  let susd: IERC20
  let mkr: IERC20
  let sushi: IERC20
  let uni: IERC20

  let trader1: Signer
  let trader2: Signer
  let trader3: Signer
  let trader4: Signer

  let partnerIndex = 0

  const defaultFee = BigNumber.from(10) // 0.1%
  const provider = waffle.provider
  const [wallet1, wallet2, wallet3, reserve, other] = provider.getWallets()

  beforeEach(async () => {
    Sincore = await (await ethers.getContractFactory('SincoreSwap')).deploy() as SincoreSwap
    await Sincore.deployed()
    const partner0 = await Sincore.partners(0)
    await Sincore.updatePartner(0, reserve.address, partner0.fee, partner0.name)

    SincoreBestRateQuery = await (await ethers.getContractFactory('SincoreBestRateQuery')).deploy(Sincore.address) as SincoreBestRateQuery
    await SincoreBestRateQuery.deployed()

    uniswapRoute = await (await ethers.getContractFactory('UniswapV2Route')).deploy(
      UNISWAP_ROUTER_ADDRESS,
      WETH_ADDRESS
    ) as ISincoreTradingRoute
    await uniswapRoute.deployed()

    sushiswapRoute = await (await ethers.getContractFactory('SushiswapRoute')).deploy() as ISincoreTradingRoute
    await sushiswapRoute.deployed()

    curveRoute = await (await ethers.getContractFactory('CurveSusdRoute')).deploy() as ISincoreTradingRoute
    await curveRoute.deployed()

    uniswapTokenEthTokenRoute = await (await ethers.getContractFactory('UniswapV2TokenEthTokenRoute')).deploy(
      UNISWAP_ROUTER_ADDRESS,
      WETH_ADDRESS
    ) as ISincoreTradingRoute
    await uniswapTokenEthTokenRoute.deployed()

    sushiswapTokenEthTokenRoute = await (await ethers.getContractFactory('UniswapV2TokenEthTokenRoute')).deploy(
      SUSHISWAP_ROUTER_ADDRESS,
      WETH_ADDRESS
    ) as ISincoreTradingRoute
    await sushiswapTokenEthTokenRoute.deployed()

    dai = await ethers.getContractAt(ERC20Abi, Assets.DAI.address) as IERC20
    usdc = await ethers.getContractAt(ERC20Abi, Assets.USDC.address) as IERC20
    usdt = await ethers.getContractAt(ERC20Abi, Assets.USDT.address) as IERC20
    susd = await ethers.getContractAt(ERC20Abi, Assets.SUSD.address) as IERC20
    mkr = await ethers.getContractAt(ERC20Abi, Assets.MKR.address) as IERC20
    sushi = await ethers.getContractAt(ERC20Abi, Assets.SUSHI.address) as IERC20
    uni = await ethers.getContractAt(ERC20Abi, Assets.UNI.address) as IERC20

    trader1 = await ethers.provider.getSigner(WhaleAddresses.a16zAddress)
    trader2 = await ethers.provider.getSigner(WhaleAddresses.binance7)
    trader3 = await ethers.provider.getSigner(WhaleAddresses.binance8)
    trader4 = await ethers.provider.getSigner(WhaleAddresses.huobi10)

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [WhaleAddresses.a16zAddress]}
    )
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [WhaleAddresses.binance7]}
    )
    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [WhaleAddresses.binance8]}
    )

    await network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [WhaleAddresses.huobi10]}
    )
  })

  it('Should initial data correctly', async () => {
    expect(await Sincore.etherERC20()).to.properAddress
    expect(await Sincore.owner()).to.properAddress

    expect(await Sincore.etherERC20()).to.equal(Assets.ETH.address)
    expect(await Sincore.owner()).to.equal(wallet1.address)

    // Platform Fee
    const partner = await Sincore.partners(0)
    const expectedName = ethers.utils.formatBytes32String('Sincore').slice(0, 34)
    expect(partner.wallet).to.equal(reserve.address)
    expect(partner.fee).to.equal(defaultFee)
    expect(partner.name).to.equal(expectedName)
  })

  describe('Deploy trading routes', async () => {
    let uniswapIndex: number
    let sushiswapIndex: number
    let curveIndex: number
    let uniswapTokenEthTokenIndex: number
    let sushiswapTokenEthTokenIndex: number
    let allRoutes: number[]
    let routesWithoutCurve: number[]

    beforeEach(async () => {
      // Uniswap
      await Sincore.addTradingRoute('Uniswap', uniswapRoute.address)
      uniswapIndex = 0
  
      // Sushiswap
      await Sincore.addTradingRoute('Sushiswap', sushiswapRoute.address)
      sushiswapIndex = 1
  
      // Curve
      await Sincore.addTradingRoute('Curve', curveRoute.address)
      curveIndex = 2

      // Uniswap Token -> ETH -> Token
      await Sincore.addTradingRoute('UniswapTokenEthToken', uniswapTokenEthTokenRoute.address)
      uniswapTokenEthTokenIndex = 3

      // Sushiswap Token -> ETH -> Token
      await Sincore.addTradingRoute('SushiswapTokenEthToken', sushiswapTokenEthTokenRoute.address)
      sushiswapTokenEthTokenIndex = 4

      await uniswapRoute.addWhitelisted(Sincore.address)
      await sushiswapRoute.addWhitelisted(Sincore.address)
      await curveRoute.addWhitelisted(Sincore.address)
      await uniswapTokenEthTokenRoute.addWhitelisted(Sincore.address)
      await sushiswapTokenEthTokenRoute.addWhitelisted(Sincore.address)

      allRoutes = [uniswapIndex, sushiswapIndex, curveIndex, uniswapTokenEthTokenIndex, sushiswapTokenEthTokenIndex]
      routesWithoutCurve = [uniswapIndex, sushiswapIndex, uniswapTokenEthTokenIndex, sushiswapTokenEthTokenIndex]
    })

    // ┌──────────────────────┬──────────────────────────────┐
    // │       (index)        │            Values            │
    // ├──────────────────────┼──────────────────────────────┤
    // │       Uniswap        │ '1326883.216050122851209126' │
    // │      Sushiswap       │ '1340666.387019448547240436' │
    // │        Curve         │            '-1.0'            │
    // │ UniswapTokenEthToken │            '0.0'             │
    // └──────────────────────┴──────────────────────────────┘
    interface Token {
      address: string
      decimals: number
    }

    async function getAmountOuts (src: Token, dest: Token, amountIn: BigNumber, routes: number[]) {
      const amountOuts = await Promise.all(routes.map(async (route) => {
        const routeName = (await Sincore.tradingRoutes(route)).name
        let amountOut: BigNumber
        try {
          amountOut = await Sincore.getDestinationReturnAmount(route, src.address, dest.address, amountIn, partnerIndex)
        } catch (error) {
          amountOut = utils.parseUnits('-1', dest.decimals)
        }
        return {
          routeIndex: route,
          route: routeName,
          amount: amountOut
        }
      }))
      return amountOuts
    }

    function bestRateFromAmountOuts (amountOuts: {routeIndex: number, route: string, amount: BigNumber}[]) {
      const top = amountOuts.sort((a, b) => {
        return a.amount.lt(b.amount) ? 1 : -1
      })[0]
      return top
    }

    async function logRates (src: Token, dest: Token, amountIn: BigNumber, routes: number[]) {
      const amountOuts = await Promise.all(routes.map(async (route) => {
        const routeName = (await Sincore.tradingRoutes(route)).name
        let amountOut: BigNumber
        try {
          amountOut = await Sincore.getDestinationReturnAmount(route, src.address, dest.address, amountIn, partnerIndex)
        } catch (error) {
          amountOut = utils.parseUnits('-1', dest.decimals)
        }
        return {
          route: routeName,
          amount: utils.formatUnits(amountOut, dest.decimals)
        }
      }))
      console.table(amountOuts.reduce((accumulator, item) => {
        // @ts-ignore
        accumulator[item.route] = item.amount
        return accumulator
      }, {}))
    }

    it('Should get split routes 1000 ETH -> DAI properly', async () => {
      const src = Assets.ETH
      const dest = Assets.DAI
      const amountIn = utils.parseUnits('1000', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const oneRouteOutput = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('==================== One Route ====================')
      console.log('routeIndex', oneRouteOutput.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(oneRouteOutput.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(oneRouteOutput.amountOut, dest.decimals))
      console.log('')


      const twoRouteOutput = await SincoreBestRateQuery.splitTwoRoutes(
        src.address,
        dest.address,
        amountIn,
        allRoutes,
        4
      )
      console.log('==================== Two Route ====================')
      console.log(`routeIndexs [${twoRouteOutput.routeIndexs[0].toString()}, ${twoRouteOutput.routeIndexs[1].toString()}]`)
      console.log(`routeIndexs [${(await Sincore.tradingRoutes(twoRouteOutput.routeIndexs[0])).name}, ${(await Sincore.tradingRoutes(twoRouteOutput.routeIndexs[1])).name}]`)
      console.log(`volumns [${twoRouteOutput.volumns[0].toString()}, ${twoRouteOutput.volumns[1].toString()}]`)
      console.log('amountOut', utils.formatUnits(twoRouteOutput.amountOut, dest.decimals))
      console.log('')

      // const amountIn1 = amountIn.mul(twoRouteOutput.volumns[0]).div(100)
      // const amountIn2 = amountIn.sub(amountIn1)
      // await expect(() => Sincore.splitTrades(
      //   [uniswapIndex, sushiswapIndex],
      //   src.address,
      //   amountIn,
      //   [amountIn1, amountIn2],
      //   dest.address,
      //   '1',
      //   partnerIndex,
      //   {
      //     value: amountIn
      //   }
      // ))
      // .to.changeTokenBalance(dai, wallet1, twoRouteOutput.amountOut)

      // ==================== One Route ====================
      // routeIndex 1
      // route Sushiswap
      // amountOut 1340666.387019448547240436

      // ==================== Two Route ====================
      // routeIndexs [0, 1]
      // routeIndexs [Uniswap, Sushiswap]
      // amountOut [30, 70] 1345345.234639529837147866
      // amountOut [35, 65] 1345385.84714968406669453
      // amountOut [32, 68] 1345386.742186744259795508
      
      // expect(output.routeIndex).to.equal(top.routeIndex)
      // expect(output.amountOut).to.equal(top.amount)
    })

    it('Should get split routes 1000 SUSHI -> ETH properly', async () => {
      const src = Assets.SUSHI
      const dest = Assets.ETH
      const amountIn = utils.parseUnits('1000', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const oneRouteOutput = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('==================== One Route ====================')
      console.log('routeIndex', oneRouteOutput.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(oneRouteOutput.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(oneRouteOutput.amountOut, dest.decimals))
      console.log('')


      const twoRouteOutput = await SincoreBestRateQuery.splitTwoRoutes(
        src.address,
        dest.address,
        amountIn,
        allRoutes,
        4
      )
      console.log('==================== Two Route ====================')
      console.log(`routeIndexs [${twoRouteOutput.routeIndexs[0].toString()}, ${twoRouteOutput.routeIndexs[1].toString()}]`)
      console.log(`routeIndexs [${(await Sincore.tradingRoutes(twoRouteOutput.routeIndexs[0])).name}, ${(await Sincore.tradingRoutes(twoRouteOutput.routeIndexs[1])).name}]`)
      console.log(`volumns [${twoRouteOutput.volumns[0].toString()}, ${twoRouteOutput.volumns[1].toString()}]`)
      console.log('amountOut', utils.formatUnits(twoRouteOutput.amountOut, dest.decimals))
      console.log('')

      const amountIn1 = amountIn.mul(twoRouteOutput.volumns[0]).div(100)
      const amountIn2 = amountIn.sub(amountIn1)

      // await sushi.connect(trader4).approve(Sincore.address, ethers.constants.MaxUint256)
      // await expect(() => Sincore.connect(trader4).splitTrades(
      //   [uniswapIndex, sushiswapIndex],
      //   src.address,
      //   amountIn,
      //   [amountIn1, amountIn2],
      //   dest.address,
      //   '1',
      //   partnerIndex
      // ))
      // .to.changeEtherBalance(trader4, twoRouteOutput.amountOut.sub(1))
    })

    it('Should get split routes 1000 SUSHI -> UNI properly', async () => {
      const src = Assets.SUSHI
      const dest = Assets.UNI
      const amountIn = utils.parseUnits('1000', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const oneRouteOutput = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('==================== One Route ====================')
      console.log('routeIndex', oneRouteOutput.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(oneRouteOutput.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(oneRouteOutput.amountOut, dest.decimals))
      console.log('')

      console.log('before splitTwoRoutes')
      const twoRouteOutput = await SincoreBestRateQuery.splitTwoRoutes(
        src.address,
        dest.address,
        amountIn,
        allRoutes,
        4,
        {
          gasLimit: MAX_BEST_RATE_SPLIT_ROUTES_QUERY_GAS_LIMIT
        }
      )
      console.log('after splitTwoRoutes')
      console.log('==================== Two Route ====================')
      console.log(`routeIndexs [${twoRouteOutput.routeIndexs[0].toString()}, ${twoRouteOutput.routeIndexs[1].toString()}]`)
      console.log(`routeIndexs [${(await Sincore.tradingRoutes(twoRouteOutput.routeIndexs[0])).name}, ${(await Sincore.tradingRoutes(twoRouteOutput.routeIndexs[1])).name}]`)
      console.log(`volumns [${twoRouteOutput.volumns[0].toString()}, ${twoRouteOutput.volumns[1].toString()}]`)
      console.log('amountOut', utils.formatUnits(twoRouteOutput.amountOut, dest.decimals))
      console.log('')

      const amountIn1 = amountIn.mul(twoRouteOutput.volumns[0]).div(100)
      const amountIn2 = amountIn.sub(amountIn1)

      // await sushi.connect(trader4).approve(Sincore.address, ethers.constants.MaxUint256)
      // await expect(() => Sincore.connect(trader4).splitTrades(
      //   [twoRouteOutput.routeIndexs[0], twoRouteOutput.routeIndexs[1]],
      //   src.address,
      //   amountIn,
      //   [amountIn1, amountIn2],
      //   dest.address,
      //   '1',
      //   partnerIndex
      // ))
      // .to.changeTokenBalance(uni, trader4, twoRouteOutput.amountOut)
    })

    it('Should get split routes with gas limit properly', async () => {
      const src = Assets.SUSHI
      const dest = Assets.UNI
      const amountIn = utils.parseUnits('1000', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const oneRouteOutput = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('==================== One Route ====================')
      console.log('routeIndex', oneRouteOutput.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(oneRouteOutput.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(oneRouteOutput.amountOut, dest.decimals))
      console.log('')

      console.log('before splitTwoRoutes')
      const twoRouteOutput = await SincoreBestRateQuery.splitTwoRoutes(
        src.address,
        dest.address,
        amountIn,
        [uniswapTokenEthTokenIndex, sushiswapTokenEthTokenIndex,
         uniswapTokenEthTokenIndex, sushiswapTokenEthTokenIndex,
         uniswapTokenEthTokenIndex, sushiswapTokenEthTokenIndex,
         uniswapTokenEthTokenIndex, sushiswapTokenEthTokenIndex,
         uniswapTokenEthTokenIndex, sushiswapTokenEthTokenIndex],
        10,
        {
          gasLimit: MAX_BEST_RATE_SPLIT_ROUTES_QUERY_GAS_LIMIT
        }
      )
      console.log('after splitTwoRoutes')
      console.log('==================== Two Route ====================')
      console.log(`routeIndexs [${twoRouteOutput.routeIndexs[0].toString()}, ${twoRouteOutput.routeIndexs[1].toString()}]`)
      console.log(`routeIndexs [${(await Sincore.tradingRoutes(twoRouteOutput.routeIndexs[0])).name}, ${(await Sincore.tradingRoutes(twoRouteOutput.routeIndexs[1])).name}]`)
      console.log(`volumns [${twoRouteOutput.volumns[0].toString()}, ${twoRouteOutput.volumns[1].toString()}]`)
      console.log('amountOut', utils.formatUnits(twoRouteOutput.amountOut, dest.decimals))
      console.log('')
    }).timeout(60000)
  })
})
