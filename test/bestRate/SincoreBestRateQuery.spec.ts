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
import { UNISWAP_ROUTER_ADDRESS, WETH_ADDRESS } from '../constants'

describe('SincoreSwap', () => {
  let Sincore: SincoreSwap
  let uniswapRoute: ISincoreTradingRoute
  let sushiswapRoute: ISincoreTradingRoute
  let curveRoute: ISincoreTradingRoute
  let uniswapTokenEthTokenRoute: ISincoreTradingRoute
  let SincoreBestRateQuery: SincoreBestRateQuery
  let dai: IERC20
  let usdc: IERC20
  let usdt: IERC20
  let susd: IERC20
  let mkr: IERC20

  let trader1: Signer
  let trader2: Signer
  let trader3: Signer

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
    await curveRoute.deployed()

    dai = await ethers.getContractAt(ERC20Abi, Assets.DAI.address) as IERC20
    usdc = await ethers.getContractAt(ERC20Abi, Assets.USDC.address) as IERC20
    usdt = await ethers.getContractAt(ERC20Abi, Assets.USDT.address) as IERC20
    susd = await ethers.getContractAt(ERC20Abi, Assets.SUSD.address) as IERC20
    mkr = await ethers.getContractAt(ERC20Abi, Assets.MKR.address) as IERC20

    trader1 = await ethers.provider.getSigner(WhaleAddresses.a16zAddress)
    trader2 = await ethers.provider.getSigner(WhaleAddresses.binance7)
    trader3 = await ethers.provider.getSigner(WhaleAddresses.binance8)

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

      await uniswapRoute.addWhitelisted(Sincore.address)
      await sushiswapRoute.addWhitelisted(Sincore.address)
      await curveRoute.addWhitelisted(Sincore.address)
      await uniswapTokenEthTokenRoute.addWhitelisted(Sincore.address)

      allRoutes = [uniswapIndex, sushiswapIndex, curveIndex, uniswapTokenEthTokenIndex]
      routesWithoutCurve = [uniswapIndex, sushiswapIndex, uniswapTokenEthTokenIndex]
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

    it('Should get route 1000 ETH -> DAI properly', async () => {
      const src = Assets.ETH
      const dest = Assets.DAI
      const amountIn = utils.parseUnits('1000', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const output = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('routeIndex', output.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(output.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(output.amountOut, dest.decimals))
      expect(output.routeIndex).to.equal(top.routeIndex)
      expect(output.amountOut).to.equal(top.amount)
    })

    it('Should get route 1,500,000 DAI -> ETH properly', async () => {
      const src = Assets.DAI
      const dest = Assets.ETH
      const amountIn = utils.parseUnits('1500000', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const output = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('routeIndex', output.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(output.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(output.amountOut, dest.decimals))
      expect(output.routeIndex).to.equal(top.routeIndex)
      expect(output.amountOut).to.equal(top.amount)
    })

    it('Should get route 1,500,000 USDC -> USDT properly', async () => {
      const src = Assets.USDC
      const dest = Assets.USDT
      const amountIn = utils.parseUnits('1500000', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const output = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('routeIndex', output.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(output.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(output.amountOut, dest.decimals))
      expect(output.routeIndex).to.equal(top.routeIndex)
      expect(output.amountOut).to.equal(top.amount)
    })

    it('Should get route 1,500,000 USDC -> ETH properly', async () => {
      const src = Assets.USDC
      const dest = Assets.ETH
      const amountIn = utils.parseUnits('1500000', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const output = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('routeIndex', output.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(output.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(output.amountOut, dest.decimals))
      expect(output.routeIndex).to.equal(top.routeIndex)
      expect(output.amountOut).to.equal(top.amount)
    })

    it('Should get route 1,000 ETH -> USDC properly', async () => {
      const src = Assets.ETH
      const dest = Assets.USDC
      const amountIn = utils.parseUnits('1000', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const output = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('routeIndex', output.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(output.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(output.amountOut, dest.decimals))
      expect(output.routeIndex).to.equal(top.routeIndex)
      expect(output.amountOut).to.equal(top.amount)
    })

    it('Should get route 1,000 MKR -> ETH properly', async () => {
      const src = Assets.MKR
      const dest = Assets.ETH
      const amountIn = utils.parseUnits('1000', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const output = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('routeIndex', output.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(output.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(output.amountOut, dest.decimals))
      expect(output.routeIndex).to.equal(top.routeIndex)
      expect(output.amountOut).to.equal(top.amount)
    })

    it('Should get route 1000 MKR -> USDT properly', async () => {
      const src = Assets.MKR
      const dest = Assets.USDT
      const amountIn = utils.parseUnits('100', src.decimals)

      const amountOuts = await getAmountOuts(src, dest, amountIn, allRoutes)
      const top = bestRateFromAmountOuts(amountOuts)
      console.log('top', top.route)
      console.log('top', top.amount.toString())

      await logRates(src, dest, amountIn, allRoutes)

      const output = await SincoreBestRateQuery.oneRoute(src.address, dest.address, amountIn, allRoutes)
      console.log('routeIndex', output.routeIndex.toString())
      console.log('route', (await Sincore.tradingRoutes(output.routeIndex)).name)
      console.log('amountOut', utils.formatUnits(output.amountOut, dest.decimals))
      expect(output.routeIndex).to.equal(top.routeIndex)
      expect(output.amountOut).to.equal(top.amount)
    })
  })
})
