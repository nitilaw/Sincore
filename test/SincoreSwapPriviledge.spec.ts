import { ethers, waffle, network, config } from 'hardhat'
import { expect } from 'chai'
import { Signer, utils, Contract, BigNumber } from 'ethers'
import ERC20Abi from './helpers/erc20Abi.json'
import WhaleAddresses from './helpers/whaleAddresses.json'
import { main as Assets } from './helpers/assets'
import { SincoreSwap } from '../typechain/SincoreSwap'
import { ISincoreTradingRoute } from '../typechain/ISincoreTradingRoute'
import { IERC20 } from '../typechain/IERC20'
import { MockToken } from '../typechain/MockToken'
import '@openzeppelin/test-helpers'
import { UNISWAP_ROUTER_ADDRESS, WETH_ADDRESS } from './constants'

describe('SincoreSwap Priviledge', () => {
  let Sincore: SincoreSwap
  let uniswapRoute: ISincoreTradingRoute
  let sushiswapRoute: ISincoreTradingRoute
  let curveRoute: ISincoreTradingRoute
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

    uniswapRoute = await (await ethers.getContractFactory('UniswapV2Route')).deploy(
      UNISWAP_ROUTER_ADDRESS,
      WETH_ADDRESS
    ) as ISincoreTradingRoute
    await uniswapRoute.deployed()

    sushiswapRoute = await (await ethers.getContractFactory('SushiswapRoute')).deploy() as ISincoreTradingRoute
    await sushiswapRoute.deployed()

    curveRoute = await (await ethers.getContractFactory('CurveSusdRoute')).deploy() as ISincoreTradingRoute
    await curveRoute.deployed()

    dai = await ethers.getContractAt(ERC20Abi, Assets.DAI.address) as IERC20
    usdc = await ethers.getContractAt(ERC20Abi, Assets.USDC.address) as IERC20
    usdt = await ethers.getContractAt(ERC20Abi, Assets.USDT.address) as IERC20
    susd = await ethers.getContractAt(ERC20Abi, Assets.SUSD.address) as IERC20
    mkr = await ethers.getContractAt(ERC20Abi, Assets.MKR.address) as IERC20

  })

  describe('Deploy trading routes', async () => {
    let uniswapIndex: number

    const amountIn = utils.parseEther('1')
    const src = Assets.ETH.address
    const dest = Assets.DAI.address

    beforeEach(async () => {
      // Uniswap
      await Sincore.addTradingRoute('Uniswap', uniswapRoute.address)
      uniswapIndex = 0

      await uniswapRoute.addWhitelisted(Sincore.address)
    })

    it('Should emit event when update Sincore token properly', async () => {
      const SincoreToken = await (await ethers.getContractFactory('MockToken')).deploy() as MockToken
      await SincoreToken.deployed()

      await expect(await Sincore.updateSincoreToken(SincoreToken.address))
      .to.emit(Sincore, 'UpdateSincoreToken')
      .withArgs(SincoreToken.address)
    })

    it('Should not allow to update warnden token if not owner', async () => {
      const SincoreToken = await (await ethers.getContractFactory('MockToken')).deploy() as MockToken
      await SincoreToken.deployed()

      await expect(Sincore.connect(wallet2).updateSincoreToken(SincoreToken.address))
      .to.revertedWith('Ownable: caller is not the owner')
    })

    describe('Deploy Sincore token', async () => {
      let SincoreToken: MockToken

      beforeEach(async () => {
        SincoreToken = await (await ethers.getContractFactory('MockToken')).deploy() as MockToken
        await SincoreToken.deployed()
        await Sincore.updateSincoreToken(SincoreToken.address);
      })

      it('Check basic info', async() => {
        expect(await SincoreToken.name()).to.be.equal('MockToken')
        expect(await SincoreToken.symbol()).to.be.equal('MOCK')
        expect(await SincoreToken.decimals()).to.be.equal(18)
        expect(await Sincore.SincoreToken()).to.be.equal(SincoreToken.address)
        expect(await Sincore.eligibleAmount()).to.be.equal(utils.parseUnits('10', 18))
      })
  
      it('Should trade without fee if have WAD = 10', async() => {
        await SincoreToken.mint(wallet1.address, utils.parseUnits('10', 18));
        expect(await SincoreToken.balanceOf(wallet1.address))
        .to.be.equal(utils.parseUnits('10', 18));
  
        const uniswapAmountOut = await uniswapRoute.getDestinationReturnAmount(src, dest, amountIn)
        const expectedAmountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, partnerIndex)
        const expectedFee = uniswapAmountOut.sub(expectedAmountOut)
  
        await expect(await Sincore.trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          '1',
          partnerIndex,
          {
            value: amountIn
          }
        ))
        .to.emit(Sincore, 'Trade')
        .withArgs(src, amountIn, dest, uniswapAmountOut, wallet1.address)
        .to.emit(uniswapRoute, 'Trade')
        .withArgs(src, amountIn, dest, uniswapAmountOut)
        .to.not.emit(Sincore, 'CollectFee')

        expect(await Sincore.isEligibleForFreeTrade(wallet1.address)).to.be.true
      })

      it('Should trade without fee if have WAD > 10', async() => {
        await SincoreToken.mint(wallet1.address, utils.parseUnits('2500', 18));
        expect(await SincoreToken.balanceOf(wallet1.address))
        .to.be.equal(utils.parseUnits('2500', 18));
  
        const uniswapAmountOut = await uniswapRoute.getDestinationReturnAmount(src, dest, amountIn)
        const expectedAmountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, partnerIndex)
        const expectedFee = uniswapAmountOut.sub(expectedAmountOut)
  
        await expect(await Sincore.trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          '1',
          partnerIndex,
          {
            value: amountIn
          }
        ))
        .to.emit(Sincore, 'Trade')
        .withArgs(src, amountIn, dest, uniswapAmountOut, wallet1.address)
        .to.emit(uniswapRoute, 'Trade')
        .withArgs(src, amountIn, dest, uniswapAmountOut)
        .to.not.emit(Sincore, 'CollectFee')

        expect(await Sincore.isEligibleForFreeTrade(wallet1.address)).to.be.true
      })

      it('Should trade with fee when WAD < 10', async() => {
        await SincoreToken.mint(wallet1.address, utils.parseUnits('5.1', 18));
        expect(await SincoreToken.balanceOf(wallet1.address))
        .to.be.equal(utils.parseUnits('5.1', 18));
  
        const uniswapAmountOut = await uniswapRoute.getDestinationReturnAmount(src, dest, amountIn)
        const expectedAmountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, partnerIndex)
        const expectedFee = uniswapAmountOut.sub(expectedAmountOut)
  
        await expect(await Sincore.trade(
          uniswapIndex,
          src,
          amountIn,
          dest,
          '1',
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

        expect(await Sincore.isEligibleForFreeTrade(wallet1.address)).to.be.false
      })

      it('Should update eligibleAmount by owner', async() => {
        const newAmount = utils.parseUnits('120', 18)

        await expect(await Sincore.updateEligibleAmount(newAmount))
        .to.emit(Sincore, 'UpdateEligibleAmount')
        .withArgs(newAmount)
        expect(await Sincore.eligibleAmount()).to.equal(newAmount)
      })

      it('Should not allow to update eligibleAmount if not owner', async() => {
        const newAmount = utils.parseUnits('120', 18)
  
        await expect(Sincore.connect(wallet2).updateEligibleAmount(newAmount))
        .to.revertedWith('Ownable: caller is not the owner')
        expect(await Sincore.eligibleAmount()).to.equal(utils.parseUnits('10', 18))
      })

      describe('Update eligibleAmount to 100', async() => {
        beforeEach(async() => {
          const newAmount = utils.parseUnits('100', 18)
          await Sincore.updateEligibleAmount(newAmount)
        })

        it('Should trade with fee when WAD > 10 && WAD < 100', async() => {
          await SincoreToken.mint(wallet1.address, utils.parseUnits('60', 18))
          expect(await SincoreToken.balanceOf(wallet1.address))
          .to.be.equal(utils.parseUnits('60', 18))
    
          const uniswapAmountOut = await uniswapRoute.getDestinationReturnAmount(src, dest, amountIn)
          const expectedAmountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, partnerIndex)
          const expectedFee = uniswapAmountOut.sub(expectedAmountOut)
    
          await expect(await Sincore.trade(
            uniswapIndex,
            src,
            amountIn,
            dest,
            '1',
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
  
          expect(await Sincore.isEligibleForFreeTrade(wallet1.address)).to.be.false
        })

        it('Should trade without fee if have WAD = 100', async() => {
          await SincoreToken.mint(wallet1.address, utils.parseUnits('100', 18))
          expect(await SincoreToken.balanceOf(wallet1.address))
          .to.be.equal(utils.parseUnits('100', 18))
    
          const uniswapAmountOut = await uniswapRoute.getDestinationReturnAmount(src, dest, amountIn)
          const expectedAmountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, partnerIndex)
    
          await expect(await Sincore.trade(
            uniswapIndex,
            src,
            amountIn,
            dest,
            '1',
            partnerIndex,
            {
              value: amountIn
            }
          ))
          .to.emit(Sincore, 'Trade')
          .withArgs(src, amountIn, dest, uniswapAmountOut, wallet1.address)
          .to.emit(uniswapRoute, 'Trade')
          .withArgs(src, amountIn, dest, uniswapAmountOut)
          .to.not.emit(Sincore, 'CollectFee')
  
          expect(await Sincore.isEligibleForFreeTrade(wallet1.address)).to.be.true
        })
      })
    })

    it('Should trade with fee when no WAD assign', async() => {
      expect(await Sincore.SincoreToken()).to.be.equal('0x0000000000000000000000000000000000000000')

      const uniswapAmountOut = await uniswapRoute.getDestinationReturnAmount(src, dest, amountIn)
      const expectedAmountOut = await Sincore.getDestinationReturnAmount(uniswapIndex, src, dest, amountIn, partnerIndex)
      const expectedFee = uniswapAmountOut.sub(expectedAmountOut)

      await expect(await Sincore.trade(
        uniswapIndex,
        src,
        amountIn,
        dest,
        '1',
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

      expect(await Sincore.isEligibleForFreeTrade(wallet1.address)).to.be.false
    })
  })
})
