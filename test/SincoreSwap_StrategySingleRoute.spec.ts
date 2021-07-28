import { ethers, waffle, network, config } from 'hardhat'
import { expect } from 'chai'
import { Signer, utils, Contract, BigNumber } from 'ethers'
import ERC20Abi from './helpers/erc20Abi.json'
import WhaleAddresses from './helpers/whaleAddresses.json'
import { main as Assets } from './helpers/assets'
import { SincoreSwap } from '../typechain/SincoreSwap'
import { ISincoreTradingRoute } from '../typechain/ISincoreTradingRoute'
import { UNISWAP_ROUTER_ADDRESS, WETH_ADDRESS } from './constants'

describe('SincoreSwap: Single route strategy', () => {
  let Sincore: SincoreSwap
  let uniswapRoute: ISincoreTradingRoute
  let sushiswapRoute: ISincoreTradingRoute
  let curveRoute: ISincoreTradingRoute
  let dai: Contract
  let usdc: Contract
  let usdt: Contract
  let susd: Contract
  let mkr: Contract

  let trader1: Signer
  let trader2: Signer
  let trader3: Signer

  const partnerIndex = 0

  const defaultFee = BigNumber.from(10) // 0.1%
  const provider = waffle.provider
  const [wallet1, wallet2, wallet3, reserve, other] = provider.getWallets()

  // before(async () => {
  //   await network.provider.request({
  //     method: "hardhat_reset",
  //     params: [{
  //       forking: {
  //         jsonRpcUrl: config.networks.hardhat.forking!.url,
  //         blockNumber: config.networks.hardhat.forking!.blockNumber
  //       }
  //     }]
  //   })
  // })

  beforeEach(async () => {
    Sincore = await (await ethers.getContractFactory('SincoreSwap')).deploy() as SincoreSwap
    await Sincore.deployed()
    const partner0 = await Sincore.partners(0)
    await Sincore.updatePartner(0, reserve.address, partner0.fee, partner0.name)

    uniswapRoute = await (await ethers.getContractFactory('UniswapV2Route')).deploy(
      UNISWAP_ROUTER_ADDRESS,
      WETH_ADDRESS
    ) as ISincoreTradingRoute
    await uniswapRoute.deployed()

    sushiswapRoute = await (await ethers.getContractFactory('SushiswapRoute')).deploy() as ISincoreTradingRoute
    await sushiswapRoute.deployed()

    curveRoute = await (await ethers.getContractFactory('CurveSusdRoute')).deploy() as ISincoreTradingRoute
    await curveRoute.deployed()

    dai = await ethers.getContractAt(ERC20Abi, Assets.DAI.address)
    usdc = await ethers.getContractAt(ERC20Abi, Assets.USDC.address)
    usdt = await ethers.getContractAt(ERC20Abi, Assets.USDT.address)
    susd = await ethers.getContractAt(ERC20Abi, Assets.SUSD.address)
    mkr = await ethers.getContractAt(ERC20Abi, Assets.MKR.address)

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

  describe('Deploy trading routes', async () => {
    let uniswapIndex: number
    let sushiswapIndex: number
    let curveIndex: number

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

      await uniswapRoute.addWhitelisted(Sincore.address)
      await sushiswapRoute.addWhitelisted(Sincore.address)
      await curveRoute.addWhitelisted(Sincore.address)
    })

    describe('Should get rates properly', async () => {
      it('Should get rate 1 ETH -> DAI properly', async () => {
        const amountIn = utils.parseEther('1')
        const src = Assets.ETH.address
        const dest = Assets.DAI.address
        const expectedAmountOut = '1354.156154766128919252'
        const amountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, 0)
        expect(utils.formatUnits(amountOut, 18))
        .to.equal(expectedAmountOut)
      })

      it('Should get rate 1500 DAI -> ETH properly', async () => {
        const amountIn = utils.parseUnits('1500', 18)
        const src = Assets.DAI.address
        const dest = Assets.ETH.address
        const expectedAmountOut = '1.09881541801256819'
        const amountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, 0)
        expect(utils.formatEther(amountOut))
        .to.equal(expectedAmountOut)
      })

      it('Should get rate 2000 DAI -> USDC properly', async () => {
        const amountIn = utils.parseUnits('2000', 18)
        const src = Assets.DAI.address
        const dest = Assets.USDC.address
        const expectedAmountOut = '1992.106083'
        const amountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, 0)
        expect(utils.formatUnits(amountOut, 6))
        .to.equal(expectedAmountOut)
      })
    })

    describe('Should trade single route 1 ETH -> DAI properly', async () => {
      const amountIn = utils.parseEther('1')
      const src = Assets.ETH.address
      const dest = Assets.DAI.address
      
      const expectedAmountOut = BigNumber.from('1354156154766128919252')
      const minDestAmount = utils.parseUnits('1350', 18)

      afterEach(async () => {
        expect(await provider.getBalance(Sincore.address)).to.equal(0)
        expect(await dai.balanceOf(Sincore.address)).to.equal(0)
      })

      it('Should receive amount out properly', async () => {
        await expect(() => Sincore.trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          minDestAmount,
          partnerIndex,
          {
            value: amountIn
          }
        ))
        .to.changeTokenBalance(dai, wallet1, expectedAmountOut)
      })

      it('Should spend properly', async () => {
        await expect(() => Sincore.trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          minDestAmount,
          partnerIndex,
          {
            value: amountIn
          }
        ))
        .to.changeEtherBalance(wallet1, BigNumber.from(0).sub(amountIn))
      })

      it('Should emit events properly', async () => {
        const uniswapAmountOut = await uniswapRoute.getDestinationReturnAmount(src, dest, amountIn)
        const expectedAmountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, partnerIndex)
        const expectedFee = uniswapAmountOut.sub(expectedAmountOut)
        console.log('uniswapAmountOut', utils.formatUnits(uniswapAmountOut, 18))
        console.log('expectedAmountOut', utils.formatUnits(expectedAmountOut, 18))
        console.log('expectedFee', utils.formatUnits(expectedFee, 18))

        await expect(await Sincore.trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          minDestAmount,
          partnerIndex,
          {
            value: amountIn
          }
        ))
        .to.emit(Sincore, 'Trade')
        .withArgs(src, amountIn, dest, expectedAmountOut, wallet1.address)
        .to.emit(uniswapRoute, 'Trade')
        .withArgs(src, amountIn, dest, uniswapAmountOut)
        .to.emit(Sincore, 'CollectFee')
        .withArgs(partnerIndex, dest, reserve.address, expectedFee)
        .to.emit(dai, 'Transfer')
        .withArgs(Sincore.address, reserve.address, expectedFee)
        .to.emit(dai, 'Transfer')
        .withArgs(Sincore.address, wallet1.address, expectedAmountOut)
      })
    })

    describe('Should trade single route 3500 DAI -> ETH properly', async () => {
      const amountIn = utils.parseUnits('3500', 18)
      const src = Assets.DAI.address
      const dest = Assets.ETH.address
      
      const expectedAmountOut = BigNumber.from('2564145416696050673')
      const expectedFee = BigNumber.from('2566712128824875')
      const minDestAmount = utils.parseUnits('2.50', 18)

      beforeEach(async () => {
        await dai.connect(trader2).approve(Sincore.address, ethers.constants.MaxUint256)
      })

      afterEach(async () => {
        expect(await dai.balanceOf(Sincore.address)).to.equal(0)
        expect(await provider.getBalance(Sincore.address)).to.equal(0)
      })

      it('Should receive amount out properly', async () => {
        await expect(() => Sincore.connect(trader2).trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          minDestAmount,
          partnerIndex
        ))
        .to.changeEtherBalances([trader2, reserve], [expectedAmountOut, expectedFee])
      })

      it('Should spend properly', async () => {
        await expect(() => Sincore.connect(trader2).trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          minDestAmount,
          partnerIndex
        ))
        .to.changeTokenBalance(dai, trader2, BigNumber.from(0).sub(amountIn))
      })

      it('Should emit events properly', async () => {
        const uniswapAmountOut = await uniswapRoute.getDestinationReturnAmount(src, dest, amountIn)
        const expectedAmountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, partnerIndex)
        const expectedFee = uniswapAmountOut.sub(expectedAmountOut)
        console.log('uniswapAmountOut', utils.formatUnits(uniswapAmountOut, 18))
        console.log('expectedAmountOut', utils.formatUnits(expectedAmountOut, 18))
        console.log('expectedFee', utils.formatUnits(expectedFee, 18))

        await expect(await Sincore.connect(trader2).trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          minDestAmount,
          partnerIndex
        ))
        .to.emit(Sincore, 'Trade')
        .withArgs(src, amountIn, dest, expectedAmountOut, await trader2.getAddress())
        .to.emit(uniswapRoute, 'Trade')
        .withArgs(src, amountIn, dest, uniswapAmountOut)
        .to.emit(Sincore, 'CollectFee')
        .withArgs(partnerIndex, dest, reserve.address, expectedFee)
      })
    })

    describe('Should trade single route 2000 DAI -> USDC properly', async () => {
      const amountIn = utils.parseUnits('2000', 18)
      const src = Assets.DAI.address
      const dest = Assets.USDC.address
      
      const expectedAmountOut = BigNumber.from('1992106083')
      const minDestAmount = utils.parseUnits('1990', 6)

      beforeEach(async () => {
        await dai.connect(trader2).approve(Sincore.address, ethers.constants.MaxUint256)
      })

      afterEach(async () => {
        expect(await dai.balanceOf(Sincore.address)).to.equal(0)
        expect(await usdc.balanceOf(Sincore.address)).to.equal(0)
      })

      it('Should receive amount out properly', async () => {
        await expect(() => Sincore.connect(trader2).trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          minDestAmount,
          partnerIndex
        ))
        .to.changeTokenBalance(usdc, trader2, expectedAmountOut)
      })

      it('Should spend properly', async () => {
        await expect(() => Sincore.connect(trader2).trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          minDestAmount,
          partnerIndex
        ))
        .to.changeTokenBalance(dai, trader2, BigNumber.from(0).sub(amountIn))
      })

      it('Should emit events properly', async () => {
        const uniswapAmountOut = await uniswapRoute.getDestinationReturnAmount(src, dest, amountIn)
        const expectedAmountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, partnerIndex)
        const expectedFee = uniswapAmountOut.sub(expectedAmountOut)
        console.log('uniswapAmountOut', utils.formatUnits(uniswapAmountOut, 18))
        console.log('expectedAmountOut', utils.formatUnits(expectedAmountOut, 18))
        console.log('expectedFee', utils.formatUnits(expectedFee, 18))

        await expect(await Sincore.connect(trader2).trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          minDestAmount,
          partnerIndex
        ))
        .to.emit(Sincore, 'Trade')
        .withArgs(src, amountIn, dest, expectedAmountOut, await trader2.getAddress())
        .to.emit(uniswapRoute, 'Trade')
        .withArgs(src, amountIn, dest, uniswapAmountOut)
        .to.emit(Sincore, 'CollectFee')
        .withArgs(partnerIndex, dest, reserve.address, expectedFee)
        .to.emit(usdc, 'Transfer')
        .withArgs(Sincore.address, reserve.address, expectedFee)
        .to.emit(usdc, 'Transfer')
        .withArgs(Sincore.address, await trader2.getAddress(), expectedAmountOut)
      })
    })
  })
})
