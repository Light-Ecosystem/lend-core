import { expect } from 'chai';
import { BigNumber } from '@ethersproject/bignumber';
import { MAX_UINT_AMOUNT, oneEther } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { HToken__factory } from './../types';
import { calcExpectedStableDebtTokenBalance } from './helpers/utils/calculations';
import { getReserveData, getUserData } from './helpers/utils/helpers';
import { makeSuite } from './helpers/make-suite';
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { waitForTx, increaseTime, evmSnapshot, evmRevert } from '@hopelend/deploy';
import { percentDiv, percentMul } from './helpers/utils/wadraymath';

declare var hre: HardhatRuntimeEnvironment;

makeSuite('Pool Liquidation: Add fee to liquidations', (testEnv) => {
  const { INVALID_HF } = ProtocolErrors;

  before(async () => {
    const { addressesProvider, oracle } = testEnv;

    await waitForTx(await addressesProvider.setPriceOracle(oracle.address));
  });

  after(async () => {
    const { hopeOracle, addressesProvider } = testEnv;
    await waitForTx(await addressesProvider.setPriceOracle(hopeOracle.address));
  });

  it('position should be liquidated when turn on liquidation protocol fee.', async () => {
    const {
      pool,
      users: [depositor, borrower, liquidator],
      usdc,
      weth,
      oracle,
      configurator,
      helpersContract,
    } = testEnv;

    const snapId = await evmSnapshot();

    const daiPrice = await oracle.getAssetPrice(usdc.address);

    //1. Depositor supplies 10000 USDC and 10 ETH
    await usdc
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(usdc.address, '10000'));
    await usdc.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .supply(
        usdc.address,
        await convertToCurrencyDecimals(usdc.address, '10000'),
        depositor.address,
        0
      );

    await weth
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '10'));
    await weth.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(depositor.signer)
      .supply(
        weth.address,
        await convertToCurrencyDecimals(weth.address, '10'),
        depositor.address,
        0
      );

    //2. Borrower supplies 10 ETH, and borrows as much USDC as it can
    await weth
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '10'));
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(borrower.signer)
      .supply(
        weth.address,
        await convertToCurrencyDecimals(weth.address, '10'),
        borrower.address,
        0
      );

    const { availableBorrowsBase } = await pool.getUserAccountData(borrower.address);
    let toBorrow = availableBorrowsBase.div(daiPrice);
    await pool
      .connect(borrower.signer)
      .borrow(usdc.address, toBorrow, RateMode.Variable, 0, borrower.address);

    //3. Liquidator supplies 10000 USDC and borrow 5 ETH
    await usdc
      .connect(liquidator.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(usdc.address, '20000'));
    await usdc.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool
      .connect(liquidator.signer)
      .supply(
        usdc.address,
        await convertToCurrencyDecimals(usdc.address, '10000'),
        liquidator.address,
        0
      );

    await pool
      .connect(liquidator.signer)
      .borrow(
        weth.address,
        await convertToCurrencyDecimals(weth.address, '1'),
        RateMode.Variable,
        0,
        liquidator.address
      );

    //4. Advance block to make ETH income index > 1
    await increaseTime(86400);

    //5. Decrease weth price to allow liquidation
    await oracle.setAssetPrice(usdc.address, '8000000000000000'); //weth = 500 usdc

    //7. Turn on liquidation protocol fee
    expect(await configurator.setLiquidationProtocolFee(weth.address, 500));
    const wethLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      weth.address
    );
    expect(wethLiquidationProtocolFee).to.be.eq(500);

    const tryMaxTimes = 20;
    for (let i = 1; i <= tryMaxTimes; i++) {
      const tmpSnap = await evmSnapshot();
      await increaseTime(i);
      expect(
        await pool
          .connect(liquidator.signer)
          .liquidationCall(weth.address, usdc.address, borrower.address, MAX_UINT_AMOUNT, false)
      );

      if (i !== tryMaxTimes) {
        await evmRevert(tmpSnap);
      }
    }
    expect(await weth.balanceOf(liquidator.address)).to.be.gt(
      await convertToCurrencyDecimals(weth.address, '5')
    );

    await evmRevert(snapId);
  });

  it('Sets the WETH protocol liquidation fee to 1000 (10.00%)', async () => {
    const { configurator, weth, hope, helpersContract } = testEnv;

    const oldWethLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      weth.address
    );
    const oldHopeLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      hope.address
    );

    const wethLiquidationProtocolFeeInput = 1000;
    const hopeLiquidationProtocolFeeInput = 500;

    expect(
      await configurator.setLiquidationProtocolFee(weth.address, wethLiquidationProtocolFeeInput)
    )
      .to.emit(configurator, 'LiquidationProtocolFeeChanged')
      .withArgs(weth.address, oldWethLiquidationProtocolFee, wethLiquidationProtocolFeeInput);
    expect(
      await configurator.setLiquidationProtocolFee(hope.address, hopeLiquidationProtocolFeeInput)
    )
      .to.emit(configurator, 'LiquidationProtocolFeeChanged')
      .withArgs(hope.address, oldHopeLiquidationProtocolFee, hopeLiquidationProtocolFeeInput);

    const wethLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      weth.address
    );
    const hopeLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      hope.address
    );

    expect(wethLiquidationProtocolFee).to.be.equal(wethLiquidationProtocolFeeInput);
    expect(hopeLiquidationProtocolFee).to.be.equal(hopeLiquidationProtocolFeeInput);
  });

  it('Deposits WETH, borrows DAI', async () => {
    const {
      dai,
      weth,
      users: [depositor, borrower],
      pool,
      oracle,
    } = testEnv;

    //mints DAI to depositor
    await dai
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(dai.address, '1000'));

    //approve protocol to access depositor wallet
    await dai.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //user 1 deposits 1000 DAI
    const amountDAItoDeposit = await convertToCurrencyDecimals(dai.address, '1000');

    await pool
      .connect(depositor.signer)
      .deposit(dai.address, amountDAItoDeposit, depositor.address, '0');
    //user 2 deposits 1 ETH
    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '0.06775');

    //mints WETH to borrower
    await weth
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '1000'));

    //approve protocol to access the borrower wallet
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(borrower.signer)
      .deposit(weth.address, amountETHtoDeposit, borrower.address, '0');

    //user 2 borrows

    const userGlobalData = await pool.getUserAccountData(borrower.address);
    const daiPrice = await oracle.getAssetPrice(dai.address);

    const amountDAIToBorrow = await convertToCurrencyDecimals(
      dai.address,
      percentMul(userGlobalData.availableBorrowsBase.div(daiPrice), 9500).toString()
    );

    await pool
      .connect(borrower.signer)
      .borrow(dai.address, amountDAIToBorrow, RateMode.Stable, '0', borrower.address);

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    expect(userGlobalDataAfter.currentLiquidationThreshold).to.be.equal(8250, INVALID_HF);
  });

  it('Drop the health factor below 1', async () => {
    const {
      dai,
      users: [, borrower],
      pool,
      oracle,
    } = testEnv;

    const daiPrice = await oracle.getAssetPrice(dai.address);

    await oracle.setAssetPrice(dai.address, percentMul(daiPrice, 11800));

    const userGlobalData = await pool.getUserAccountData(borrower.address);

    expect(userGlobalData.healthFactor).to.be.lt(oneEther, INVALID_HF);
  });

  it('Liquidates the borrow', async () => {
    const {
      dai,
      weth,
      hWETH,
      users: [, borrower, , liquidator],
      pool,
      oracle,
      helpersContract,
    } = testEnv;

    //mints dai to the liquidator
    await dai
      .connect(liquidator.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(dai.address, '1000'));

    //approve protocol to access the liquidator wallet
    await dai.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const daiReserveDataBefore = await getReserveData(helpersContract, dai.address);
    const ethReserveDataBefore = await getReserveData(helpersContract, weth.address);

    const liquidatorBalanceBefore = await weth.balanceOf(liquidator.address);

    const treasuryAddress = await hWETH.RESERVE_TREASURY_ADDRESS();
    const treasuryDataBefore = await helpersContract.getUserReserveData(
      weth.address,
      treasuryAddress
    );
    const treasuryBalanceBefore = treasuryDataBefore.currentHTokenBalance;

    const userReserveDataBefore = await getUserData(
      pool,
      helpersContract,
      dai.address,
      borrower.address
    );

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    const wethLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      weth.address
    );

    await increaseTime(100);

    const tx = await pool
      .connect(liquidator.signer)
      .liquidationCall(weth.address, dai.address, borrower.address, amountToLiquidate, false);

    const userReserveDataAfter = await getUserData(
      pool,
      helpersContract,
      dai.address,
      borrower.address
    );

    const daiReserveDataAfter = await getReserveData(helpersContract, dai.address);
    const ethReserveDataAfter = await getReserveData(helpersContract, weth.address);

    const liquidatorBalanceAfter = await weth.balanceOf(liquidator.address);

    const treasuryDataAfter = await helpersContract.getUserReserveData(
      weth.address,
      treasuryAddress
    );
    const treasuryBalanceAfter = treasuryDataAfter.currentHTokenBalance;

    const collateralPrice = await oracle.getAssetPrice(weth.address);
    const principalPrice = await oracle.getAssetPrice(dai.address);

    const collateralDecimals = (await helpersContract.getReserveConfigurationData(weth.address))
      .decimals;
    const principalDecimals = (await helpersContract.getReserveConfigurationData(dai.address))
      .decimals;

    const baseCollateral = principalPrice
      .mul(amountToLiquidate)
      .mul(BigNumber.from(10).pow(collateralDecimals))
      .div(collateralPrice.mul(BigNumber.from(10).pow(principalDecimals)));

    const bonusCollateral = percentMul(baseCollateral, 10500).sub(baseCollateral);
    const totalCollateralLiquidated = baseCollateral.add(bonusCollateral);
    const liquidationProtocolFees = percentMul(bonusCollateral, wethLiquidationProtocolFee);
    const expectedLiquidationReward = totalCollateralLiquidated.sub(liquidationProtocolFees);

    if (!tx.blockNumber) {
      expect(false, 'Invalid block number');
      return;
    }
    const txTimestamp = BigNumber.from(
      (await hre.ethers.provider.getBlock(tx.blockNumber)).timestamp
    );

    const stableDebtBeforeTx = calcExpectedStableDebtTokenBalance(
      userReserveDataBefore.principalStableDebt,
      userReserveDataBefore.stableBorrowRate,
      userReserveDataBefore.stableRateLastUpdated,
      txTimestamp
    );

    expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
      stableDebtBeforeTx.sub(amountToLiquidate),
      2,
      'Invalid user debt after liquidation'
    );

    //the liquidity index of the principal reserve needs to be bigger than the index before
    expect(daiReserveDataAfter.liquidityIndex).to.be.gte(
      daiReserveDataBefore.liquidityIndex,
      'Invalid liquidity index'
    );

    //the principal APY after a liquidation needs to be lower than the APY before
    expect(daiReserveDataAfter.liquidityRate).to.be.lt(
      daiReserveDataBefore.liquidityRate,
      'Invalid liquidity APY'
    );

    expect(daiReserveDataAfter.availableLiquidity).to.be.closeTo(
      daiReserveDataBefore.availableLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal available liquidity'
    );

    expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
      ethReserveDataBefore.availableLiquidity.sub(expectedLiquidationReward),
      2,
      'Invalid collateral available liquidity'
    );

    expect(treasuryBalanceAfter).to.be.closeTo(
      treasuryBalanceBefore.add(liquidationProtocolFees),
      2,
      'Invalid treasury increase'
    );

    expect(liquidatorBalanceAfter).to.be.closeTo(
      liquidatorBalanceBefore.add(expectedLiquidationReward),
      2,
      'Invalid liquidator balance'
    );

    expect(daiReserveDataAfter.totalLiquidity).to.be.closeTo(
      daiReserveDataBefore.totalLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal total liquidity'
    );

    expect(ethReserveDataAfter.totalLiquidity).to.be.closeTo(
      ethReserveDataBefore.totalLiquidity.sub(
        totalCollateralLiquidated.sub(liquidationProtocolFees)
      ),
      2,
      'Invalid collateral total liquidity'
    );
  });

  it('User 3 deposits 1000 USDC, user 4 0.06775 WETH, user 4 borrows - drops HF, liquidates the borrow', async () => {
    const {
      usdc,
      users: [, , , depositor, borrower, liquidator],
      pool,
      oracle,
      weth,
      hWETH,
      helpersContract,
    } = testEnv;

    //mints USDC to depositor
    await usdc
      .connect(depositor.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(usdc.address, '1000'));

    //approve protocol to access depositor wallet
    await usdc.connect(depositor.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //depositor deposits 1000 USDC
    const amountUSDCtoDeposit = await convertToCurrencyDecimals(usdc.address, '1000');

    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, amountUSDCtoDeposit, depositor.address, '0');

    //borrower deposits 1 ETH
    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '0.06775');

    //mints WETH to borrower
    await weth
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '1000'));

    //approve protocol to access the borrower wallet
    await weth.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    await pool
      .connect(borrower.signer)
      .deposit(weth.address, amountETHtoDeposit, borrower.address, '0');

    //borrower borrows
    const userGlobalData = await pool.getUserAccountData(borrower.address);

    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    const amountUSDCToBorrow = await convertToCurrencyDecimals(
      usdc.address,
      percentMul(userGlobalData.availableBorrowsBase.div(usdcPrice), 9502).toString()
    );

    await pool
      .connect(borrower.signer)
      .borrow(usdc.address, amountUSDCToBorrow, RateMode.Stable, '0', borrower.address);

    //drops HF below 1
    await oracle.setAssetPrice(usdc.address, percentMul(usdcPrice, 11200));

    //mints usdc to the liquidator
    await usdc
      .connect(liquidator.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(usdc.address, '1000'));

    //approve protocol to access liquidator wallet
    await usdc.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const usdcReserveDataBefore = await getReserveData(helpersContract, usdc.address);
    const ethReserveDataBefore = await getReserveData(helpersContract, weth.address);

    const liquidatorBalanceBefore = await weth.balanceOf(liquidator.address);

    const treasuryAddress = await hWETH.RESERVE_TREASURY_ADDRESS();
    const treasuryDataBefore = await helpersContract.getUserReserveData(
      weth.address,
      treasuryAddress
    );
    const treasuryBalanceBefore = treasuryDataBefore.currentHTokenBalance;

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    const wethLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      weth.address
    );

    await pool
      .connect(liquidator.signer)
      .liquidationCall(weth.address, usdc.address, borrower.address, amountToLiquidate, false);

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    const usdcReserveDataAfter = await getReserveData(helpersContract, usdc.address);
    const ethReserveDataAfter = await getReserveData(helpersContract, weth.address);

    const liquidatorBalanceAfter = await weth.balanceOf(liquidator.address);
    const treasuryDataAfter = await helpersContract.getUserReserveData(
      weth.address,
      treasuryAddress
    );
    const treasuryBalanceAfter = treasuryDataAfter.currentHTokenBalance;

    const collateralPrice = await oracle.getAssetPrice(weth.address);
    const principalPrice = await oracle.getAssetPrice(usdc.address);

    const collateralDecimals = (await helpersContract.getReserveConfigurationData(weth.address))
      .decimals;
    const principalDecimals = (await helpersContract.getReserveConfigurationData(usdc.address))
      .decimals;

    const baseCollateral = principalPrice
      .mul(amountToLiquidate)
      .mul(BigNumber.from(10).pow(collateralDecimals))
      .div(collateralPrice.mul(BigNumber.from(10).pow(principalDecimals)));

    const bonusCollateral = percentMul(baseCollateral, 10500).sub(baseCollateral);
    const totalCollateralLiquidated = baseCollateral.add(bonusCollateral);
    const liquidationProtocolFees = percentMul(bonusCollateral, wethLiquidationProtocolFee);
    const expectedLiquidationReward = totalCollateralLiquidated.sub(liquidationProtocolFees);

    expect(userGlobalDataAfter.healthFactor).to.be.gt(oneEther, 'Invalid health factor');

    expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
      userReserveDataBefore.currentStableDebt.sub(amountToLiquidate),
      2,
      'Invalid user borrow balance after liquidation'
    );

    //the liquidity index of the principal reserve needs to be bigger than the index before
    expect(usdcReserveDataAfter.liquidityIndex).to.be.gte(
      usdcReserveDataBefore.liquidityIndex,
      'Invalid liquidity index'
    );

    //the principal APY after a liquidation needs to be lower than the APY before
    expect(usdcReserveDataAfter.liquidityRate).to.be.lt(
      usdcReserveDataBefore.liquidityRate,
      'Invalid liquidity APY'
    );

    expect(usdcReserveDataAfter.availableLiquidity).to.be.closeTo(
      usdcReserveDataBefore.availableLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal available liquidity'
    );

    expect(ethReserveDataAfter.availableLiquidity).to.be.closeTo(
      ethReserveDataBefore.availableLiquidity.sub(expectedLiquidationReward),
      2,
      'Invalid collateral available liquidity'
    );

    expect(treasuryBalanceAfter).to.be.closeTo(
      treasuryBalanceBefore.add(liquidationProtocolFees),
      2,
      'Invalid treasury increase'
    );

    expect(liquidatorBalanceAfter).to.be.closeTo(
      liquidatorBalanceBefore.add(expectedLiquidationReward),
      2,
      'Invalid liquidator balance'
    );

    expect(usdcReserveDataAfter.totalLiquidity).to.be.closeTo(
      usdcReserveDataBefore.totalLiquidity.add(amountToLiquidate),
      2,
      'Invalid principal total liquidity'
    );

    expect(ethReserveDataAfter.totalLiquidity).to.be.closeTo(
      ethReserveDataBefore.totalLiquidity.sub(
        totalCollateralLiquidated.sub(liquidationProtocolFees)
      ),
      2,
      'Invalid collateral total liquidity'
    );
  });

  it('User 4 deposits 0.03 HOPE - drops HF, liquidates the HOPE, which results on a lower amount being liquidated', async () => {
    const snap = await evmSnapshot();
    const {
      hope,
      usdc,
      users: [, , , , borrower, liquidator],
      pool,
      oracle,
      helpersContract,
    } = testEnv;

    //mints HOPE to borrower
    await hope
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(hope.address, '0.03'));

    //approve protocol to access the borrower wallet
    await hope.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //borrower deposits HOPE
    const amountToDeposit = await convertToCurrencyDecimals(hope.address, '0.03');

    await pool
      .connect(borrower.signer)
      .deposit(hope.address, amountToDeposit, borrower.address, '0');
    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    //drops HF below 1
    await oracle.setAssetPrice(usdc.address, percentMul(usdcPrice, 11400));

    //mints usdc to the liquidator
    await usdc
      .connect(liquidator.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(usdc.address, '1000'));

    //approve protocol to access liquidator wallet
    await usdc.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const usdcReserveDataBefore = await getReserveData(helpersContract, usdc.address);
    const hopeReserveDataBefore = await getReserveData(helpersContract, hope.address);

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    const collateralPrice = await oracle.getAssetPrice(hope.address);
    const principalPrice = await oracle.getAssetPrice(usdc.address);

    const hopeTokenAddresses = await helpersContract.getReserveTokensAddresses(hope.address);
    const hHopeTokenAddress = await hopeTokenAddresses.hTokenAddress;
    const hHopeTokenContract = await HToken__factory.connect(
      hHopeTokenAddress,
      hre.ethers.provider
    );
    const hHopeTokenBalanceBefore = await hHopeTokenContract.balanceOf(liquidator.address);
    const borrowerHTokenBalance = await hHopeTokenContract.balanceOf(borrower.address);

    const treasuryAddress = await hHopeTokenContract.RESERVE_TREASURY_ADDRESS();
    const treasuryDataBefore = await helpersContract.getUserReserveData(
      hope.address,
      treasuryAddress
    );
    const treasuryBalanceBefore = treasuryDataBefore.currentHTokenBalance;

    await pool
      .connect(liquidator.signer)
      .liquidationCall(hope.address, usdc.address, borrower.address, amountToLiquidate, true);

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    const usdcReserveDataAfter = await getReserveData(helpersContract, usdc.address);
    const hopeReserveDataAfter = await getReserveData(helpersContract, hope.address);

    const hopeConfiguration = await helpersContract.getReserveConfigurationData(hope.address);
    const collateralDecimals = hopeConfiguration.decimals;
    const liquidationBonus = hopeConfiguration.liquidationBonus;

    const principalDecimals = (await helpersContract.getReserveConfigurationData(usdc.address))
      .decimals;

    const expectedCollateralLiquidated = oneEther.mul(30).div(1000);

    const hopeLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      hope.address
    );

    const expectedPrincipal = percentDiv(
      collateralPrice
        .mul(expectedCollateralLiquidated)
        .mul(BigNumber.from(10).pow(principalDecimals))
        .div(principalPrice.mul(BigNumber.from(10).pow(collateralDecimals))),
      liquidationBonus
    );

    const bonusCollateral = borrowerHTokenBalance.sub(
      percentDiv(borrowerHTokenBalance, liquidationBonus)
    );
    const liquidationProtocolFee = percentMul(bonusCollateral, hopeLiquidationProtocolFee);
    const expectedLiquidationReward = borrowerHTokenBalance.sub(liquidationProtocolFee);

    const hHopeTokenBalanceAfter = await hHopeTokenContract.balanceOf(liquidator.address);

    const treasuryDataAfter = await helpersContract.getUserReserveData(
      hope.address,
      treasuryAddress
    );
    const treasuryBalanceAfter = treasuryDataAfter.currentHTokenBalance;

    expect(userGlobalDataAfter.healthFactor).to.be.gt(oneEther, 'Invalid health factor');

    expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
      userReserveDataBefore.currentStableDebt.sub(expectedPrincipal),
      2,
      'Invalid user borrow balance after liquidation'
    );

    expect(usdcReserveDataAfter.availableLiquidity).to.be.closeTo(
      usdcReserveDataBefore.availableLiquidity.add(expectedPrincipal),
      2,
      'Invalid principal available liquidity'
    );

    expect(hopeReserveDataAfter.availableLiquidity).to.be.closeTo(
      hopeReserveDataBefore.availableLiquidity,
      2,
      'Invalid collateral available liquidity'
    );

    expect(usdcReserveDataAfter.totalLiquidity).to.be.closeTo(
      usdcReserveDataBefore.totalLiquidity.add(expectedPrincipal),
      2,
      'Invalid principal total liquidity'
    );

    expect(hopeReserveDataAfter.totalLiquidity).to.be.closeTo(
      hopeReserveDataBefore.totalLiquidity,
      2,
      'Invalid collateral total liquidity'
    );

    expect(hHopeTokenBalanceBefore).to.be.equal(
      hHopeTokenBalanceAfter.sub(expectedLiquidationReward),
      'Liquidator hToken balance incorrect'
    );

    expect(treasuryBalanceBefore).to.be.equal(
      treasuryBalanceAfter.sub(liquidationProtocolFee),
      'Treasury hToken balance incorrect'
    );

    await evmRevert(snap);
  });

  it('Set liquidationProtocolFee to 0. User 4 deposits 0.03 HOPE - drops HF, liquidates the HOPE, which results on a lower amount being liquidated', async () => {
    const {
      hope,
      usdc,
      users: [, , , , borrower, liquidator],
      pool,
      oracle,
      helpersContract,
      configurator,
    } = testEnv;

    const oldHopeLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      hope.address
    );

    expect(await configurator.setLiquidationProtocolFee(hope.address, 0))
      .to.emit(configurator, 'LiquidationProtocolFeeChanged')
      .withArgs(hope.address, oldHopeLiquidationProtocolFee, 0);

    //mints HOPE to borrower
    await hope
      .connect(borrower.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(hope.address, '0.03'));

    //approve protocol to access the borrower wallet
    await hope.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);

    //borrower deposits HOPE
    const amountToDeposit = await convertToCurrencyDecimals(hope.address, '0.03');

    await pool
      .connect(borrower.signer)
      .deposit(hope.address, amountToDeposit, borrower.address, '0');
    const usdcPrice = await oracle.getAssetPrice(usdc.address);

    //drops HF below 1
    await oracle.setAssetPrice(usdc.address, percentMul(usdcPrice, 11400));

    //mints usdc to the liquidator
    await usdc
      .connect(liquidator.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(usdc.address, '1000'));

    //approve protocol to access liquidator wallet
    await usdc.connect(liquidator.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const userReserveDataBefore = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const usdcReserveDataBefore = await getReserveData(helpersContract, usdc.address);
    const hopeReserveDataBefore = await getReserveData(helpersContract, hope.address);

    const amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2);

    const collateralPrice = await oracle.getAssetPrice(hope.address);
    const principalPrice = await oracle.getAssetPrice(usdc.address);

    const hopeTokenAddresses = await helpersContract.getReserveTokensAddresses(hope.address);
    const hHopeTokenAddress = await hopeTokenAddresses.hTokenAddress;
    const hHopeTokenContract = await HToken__factory.connect(
      hHopeTokenAddress,
      hre.ethers.provider
    );
    const hHopeTokenBalanceBefore = await hHopeTokenContract.balanceOf(liquidator.address);
    const borrowerHTokenBalance = await hHopeTokenContract.balanceOf(borrower.address);

    const treasuryAddress = await hHopeTokenContract.RESERVE_TREASURY_ADDRESS();
    const treasuryDataBefore = await helpersContract.getUserReserveData(
      hope.address,
      treasuryAddress
    );
    const treasuryBalanceBefore = treasuryDataBefore.currentHTokenBalance;

    await pool
      .connect(liquidator.signer)
      .liquidationCall(hope.address, usdc.address, borrower.address, amountToLiquidate, true);

    const userReserveDataAfter = await helpersContract.getUserReserveData(
      usdc.address,
      borrower.address
    );

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address);

    const usdcReserveDataAfter = await getReserveData(helpersContract, usdc.address);
    const hopeReserveDataAfter = await getReserveData(helpersContract, hope.address);

    const hopeConfiguration = await helpersContract.getReserveConfigurationData(hope.address);
    const collateralDecimals = hopeConfiguration.decimals;
    const liquidationBonus = hopeConfiguration.liquidationBonus;

    const principalDecimals = (await helpersContract.getReserveConfigurationData(usdc.address))
      .decimals;

    const expectedCollateralLiquidated = oneEther.mul(30).div(1000);

    const hopeLiquidationProtocolFee = await helpersContract.getLiquidationProtocolFee(
      hope.address
    );

    const expectedPrincipal = percentDiv(
      collateralPrice
        .mul(expectedCollateralLiquidated)
        .mul(BigNumber.from(10).pow(principalDecimals))
        .div(principalPrice.mul(BigNumber.from(10).pow(collateralDecimals))),
      liquidationBonus
    );

    const bonusCollateral = borrowerHTokenBalance.sub(
      percentDiv(borrowerHTokenBalance, liquidationBonus)
    );
    const liquidationProtocolFee = percentMul(bonusCollateral, hopeLiquidationProtocolFee);
    const expectedLiquidationReward = borrowerHTokenBalance.sub(liquidationProtocolFee);

    const hHopeTokenBalanceAfter = await hHopeTokenContract.balanceOf(liquidator.address);

    const treasuryDataAfter = await helpersContract.getUserReserveData(
      hope.address,
      treasuryAddress
    );
    const treasuryBalanceAfter = treasuryDataAfter.currentHTokenBalance;

    expect(userGlobalDataAfter.healthFactor).to.be.gt(oneEther, 'Invalid health factor');

    expect(userReserveDataAfter.currentStableDebt).to.be.closeTo(
      userReserveDataBefore.currentStableDebt.sub(expectedPrincipal),
      2,
      'Invalid user borrow balance after liquidation'
    );

    expect(usdcReserveDataAfter.availableLiquidity).to.be.closeTo(
      usdcReserveDataBefore.availableLiquidity.add(expectedPrincipal),
      2,
      'Invalid principal available liquidity'
    );

    expect(hopeReserveDataAfter.availableLiquidity).to.be.closeTo(
      hopeReserveDataBefore.availableLiquidity,
      2,
      'Invalid collateral available liquidity'
    );

    expect(usdcReserveDataAfter.totalLiquidity).to.be.closeTo(
      usdcReserveDataBefore.totalLiquidity.add(expectedPrincipal),
      2,
      'Invalid principal total liquidity'
    );

    expect(hopeReserveDataAfter.totalLiquidity).to.be.closeTo(
      hopeReserveDataBefore.totalLiquidity,
      2,
      'Invalid collateral total liquidity'
    );

    expect(hHopeTokenBalanceBefore).to.be.equal(
      hHopeTokenBalanceAfter.sub(expectedLiquidationReward),
      'Liquidator hToken balance incorrect'
    );

    expect(treasuryBalanceBefore).to.be.equal(
      treasuryBalanceAfter.sub(liquidationProtocolFee),
      'Treasury hToken balance incorrect'
    );
  });
});
