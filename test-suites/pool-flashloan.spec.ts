import { deployDefaultReserveInterestRateStrategy } from '@hopelend/deploy/dist/helpers/contract-deployments';
import { expect } from 'chai';
import { BigNumber, ethers, Event, utils } from 'ethers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors } from '../helpers/types';

import {
  getMockFlashLoanReceiver,
  getStableDebtToken,
  getVariableDebtToken,
} from '@hopelend/deploy/dist/helpers/contract-getters';
import { TestEnv, makeSuite } from './helpers/make-suite';
import './helpers/utils/wadraymath';
import { waitForTx } from '@hopelend/deploy';
import { MockHTokenRepayment__factory, MockFlashLoanReceiver } from './../types';

makeSuite('Pool: FlashLoan', (testEnv: TestEnv) => {
  let _mockFlashLoanReceiver = {} as MockFlashLoanReceiver;

  const {
    COLLATERAL_BALANCE_IS_ZERO,
    ERC20_TRANSFER_AMOUNT_EXCEEDS_BALANCE,
    INVALID_FLASHLOAN_EXECUTOR_RETURN,
    FLASHLOAN_DISABLED,
    BORROWING_NOT_ENABLED,
  } = ProtocolErrors;

  const TOTAL_PREMIUM = 9;
  const PREMIUM_TO_PROTOCOL = 3000;

  before(async () => {
    const { weth, hope, dai, usdc, hUsdc, pool, configurator, deployer } = testEnv;
    _mockFlashLoanReceiver = await getMockFlashLoanReceiver();
    await weth.addMinter(_mockFlashLoanReceiver.address);
    await hope.addMinter(_mockFlashLoanReceiver.address);
    await dai.addMinter(_mockFlashLoanReceiver.address);

    const hTokenRepayImpl = await new MockHTokenRepayment__factory(deployer.signer).deploy(
      pool.address
    );

    await configurator.updateHToken({
      asset: usdc.address,
      treasury: await hUsdc.RESERVE_TREASURY_ADDRESS(),
      name: await hUsdc.name(),
      symbol: await hUsdc.symbol(),
      implementation: hTokenRepayImpl.address,
      params: '0x',
    });
  });

  it('Configurator sets total premium = 9 bps, premium to protocol = 30%', async () => {
    const { configurator, pool } = testEnv;
    await configurator.updateFlashloanPremiumTotal(TOTAL_PREMIUM);
    await configurator.updateFlashloanPremiumToProtocol(PREMIUM_TO_PROTOCOL);

    expect(await pool.FLASHLOAN_PREMIUM_TOTAL()).to.be.equal(TOTAL_PREMIUM);
    expect(await pool.FLASHLOAN_PREMIUM_TO_PROTOCOL()).to.be.equal(PREMIUM_TO_PROTOCOL);
  });
  it('Deposits WETH into the reserve', async () => {
    const { pool, weth, hope, dai } = testEnv;
    const userAddress = await pool.signer.getAddress();
    const amountToDeposit = ethers.utils.parseEther('1');

    await weth['mint(uint256)'](amountToDeposit);

    await weth.approve(pool.address, MAX_UINT_AMOUNT);

    await pool.deposit(weth.address, amountToDeposit, userAddress, '0');

    await hope['mint(uint256)'](amountToDeposit);

    await hope.approve(pool.address, MAX_UINT_AMOUNT);

    await pool.deposit(hope.address, amountToDeposit, userAddress, '0');
    await dai['mint(uint256)'](amountToDeposit);

    await dai.approve(pool.address, MAX_UINT_AMOUNT);

    await pool.deposit(dai.address, amountToDeposit, userAddress, '0');
  });

  it('Takes WETH + Dai flash loan with mode = 0, returns the funds correctly', async () => {
    const { pool, helpersContract, weth, hWETH, dai, hDai } = testEnv;

    const wethFlashBorrowedAmount = ethers.utils.parseEther('0.8');
    const daiFlashBorrowedAmount = ethers.utils.parseEther('0.3');
    const wethTotalFees = wethFlashBorrowedAmount.mul(TOTAL_PREMIUM).div(10000);
    const wethFeesToProtocol = wethTotalFees.mul(PREMIUM_TO_PROTOCOL).div(10000);
    const wethFeesToLp = wethTotalFees.sub(wethFeesToProtocol);
    const daiTotalFees = daiFlashBorrowedAmount.mul(TOTAL_PREMIUM).div(10000);
    const daiFeesToProtocol = daiTotalFees.mul(PREMIUM_TO_PROTOCOL).div(10000);
    const daiFeesToLp = daiTotalFees.sub(daiFeesToProtocol);

    const wethLiquidityIndexAdded = wethFeesToLp
      .mul(BigNumber.from(10).pow(27))
      .div(await hWETH.totalSupply());

    const daiLiquidityIndexAdded = daiFeesToLp
      .mul(ethers.BigNumber.from(10).pow(27))
      .div(await hDai.totalSupply());

    let wethReserveData = await helpersContract.getReserveData(weth.address);
    let daiReserveData = await helpersContract.getReserveData(dai.address);

    const wethLiquidityIndexBefore = wethReserveData.liquidityIndex;
    const daiLiquidityIndexBefore = daiReserveData.liquidityIndex;

    const wethTotalLiquidityBefore = wethReserveData.totalHToken;

    const daiTotalLiquidityBefore = daiReserveData.totalHToken;

    const wethReservesBefore = await hWETH.balanceOf(await hWETH.RESERVE_TREASURY_ADDRESS());
    const daiReservesBefore = await hDai.balanceOf(await hDai.RESERVE_TREASURY_ADDRESS());

    const tx = await waitForTx(
      await pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address, dai.address],
        [wethFlashBorrowedAmount, daiFlashBorrowedAmount],
        [0, 0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
    );

    await pool.mintToTreasury([weth.address, dai.address]);

    wethReserveData = await helpersContract.getReserveData(weth.address);
    daiReserveData = await helpersContract.getReserveData(dai.address);

    const wethCurrentLiquidityRate = wethReserveData.liquidityRate;
    const wethCurrentLiquidityIndex = wethReserveData.liquidityIndex;
    const daiCurrentLiquidityRate = daiReserveData.liquidityRate;
    const daiCurrentLiquidityIndex = daiReserveData.liquidityIndex;

    const wethTotalLiquidityAfter = wethReserveData.totalHToken;

    const daiTotalLiquidityAfter = daiReserveData.totalHToken;

    const wethReservesAfter = await hWETH.balanceOf(await hWETH.RESERVE_TREASURY_ADDRESS());
    const daiReservesAfter = await hDai.balanceOf(await hDai.RESERVE_TREASURY_ADDRESS());

    expect(wethTotalLiquidityBefore.add(wethTotalFees)).to.be.closeTo(wethTotalLiquidityAfter, 2);
    expect(wethCurrentLiquidityRate).to.be.equal(0);
    expect(wethCurrentLiquidityIndex).to.be.equal(
      wethLiquidityIndexBefore.add(wethLiquidityIndexAdded)
    );
    expect(wethReservesAfter).to.be.equal(wethReservesBefore.add(wethFeesToProtocol));

    expect(daiTotalLiquidityBefore.add(daiTotalFees)).to.be.closeTo(daiTotalLiquidityAfter, 2);
    expect(daiCurrentLiquidityRate).to.be.equal(0);
    expect(daiCurrentLiquidityIndex).to.be.equal(
      daiLiquidityIndexBefore.add(daiLiquidityIndexAdded)
    );
    expect(daiReservesAfter).to.be.equal(daiReservesBefore.add(daiFeesToProtocol));

    // Check event values for `ReserveDataUpdated`
    const reserveDataUpdatedEvents = tx.events?.filter(
      ({ event }) => event === 'ReserveDataUpdated'
    ) as Event[];
    for (const reserveDataUpdatedEvent of reserveDataUpdatedEvents) {
      const reserveData = await helpersContract.getReserveData(
        reserveDataUpdatedEvent.args?.reserve
      );
      expect(reserveData.liquidityRate).to.be.eq(reserveDataUpdatedEvent.args?.liquidityRate);
      expect(reserveData.stableBorrowRate).to.be.eq(reserveDataUpdatedEvent.args?.stableBorrowRate);
      expect(reserveData.variableBorrowRate).to.be.eq(
        reserveDataUpdatedEvent.args?.variableBorrowRate
      );
      expect(reserveData.liquidityIndex).to.be.eq(reserveDataUpdatedEvent.args?.liquidityIndex);
      expect(reserveData.variableBorrowIndex).to.be.eq(
        reserveDataUpdatedEvent.args?.variableBorrowIndex
      );
    }
  });

  it('Takes an authorized HOPE flash loan with mode = 0, returns the funds correctly', async () => {
    const {
      pool,
      helpersContract,
      hope,
      aclManager,
      users: [, , , authorizedUser],
    } = testEnv;

    expect(await aclManager.addFlashBorrower(authorizedUser.address));

    const flashBorrowedAmount = ethers.utils.parseEther('0.8');
    const totalFees = BigNumber.from(0);

    let reserveData = await helpersContract.getReserveData(hope.address);

    const totalLiquidityBefore = reserveData.totalHToken;

    await pool
      .connect(authorizedUser.signer)
      .flashLoan(
        _mockFlashLoanReceiver.address,
        [hope.address],
        [flashBorrowedAmount],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      );

    await pool.mintToTreasury([hope.address]);

    reserveData = await helpersContract.getReserveData(hope.address);

    const totalLiquidityAfter = reserveData.totalHToken;

    expect(totalLiquidityBefore.add(totalFees)).to.be.closeTo(totalLiquidityAfter, 2);
  });

  it('Takes an ETH flashloan with mode = 0 as big as the available liquidity', async () => {
    const { pool, helpersContract, weth, hWETH, deployer } = testEnv;

    let reserveData = await helpersContract.getReserveData(weth.address);

    const totalLiquidityBefore = reserveData.totalHToken;

    const flashBorrowedAmount = totalLiquidityBefore;

    const totalFees = flashBorrowedAmount.mul(TOTAL_PREMIUM).div(10000);
    const feesToProtocol = totalFees.mul(PREMIUM_TO_PROTOCOL).div(10000);
    const feesToLp = totalFees.sub(feesToProtocol);
    const liquidityIndexBefore = reserveData.liquidityIndex;
    const liquidityIndexAdded = feesToLp
      .mul(BigNumber.from(10).pow(27))
      .div((await hWETH.totalSupply()).toString())
      .mul(liquidityIndexBefore)
      .div(BigNumber.from(10).pow(27));

    const reservesBefore = await hWETH.balanceOf(await hWETH.RESERVE_TREASURY_ADDRESS());

    expect(
      await pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address],
        [flashBorrowedAmount],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
    )
      .to.emit(pool, 'FlashLoan')
      .withArgs(
        _mockFlashLoanReceiver.address,
        deployer.address,
        weth.address,
        flashBorrowedAmount,
        0,
        flashBorrowedAmount.mul(9).div(10000),
        0
      );
    await pool.mintToTreasury([weth.address]);

    reserveData = await helpersContract.getReserveData(weth.address);

    const currentLiquidityRate = reserveData.liquidityRate;
    const currentLiquidityIndex = reserveData.liquidityIndex;

    const totalLiquidityAfter = reserveData.totalHToken;

    const reservesAfter = await hWETH.balanceOf(await hWETH.RESERVE_TREASURY_ADDRESS());
    expect(totalLiquidityBefore.add(totalFees)).to.be.closeTo(totalLiquidityAfter, 2);
    expect(currentLiquidityRate).to.be.equal(0);
    expect(currentLiquidityIndex).to.be.equal(liquidityIndexBefore.add(liquidityIndexAdded));
    expect(
      reservesAfter.sub(feesToProtocol).mul(liquidityIndexBefore).div(currentLiquidityIndex)
    ).to.be.closeTo(reservesBefore, 2);
  });

  it('Disable ETH flashloan and takes an ETH flashloan (revert expected)', async () => {
    const { pool, configurator, helpersContract, weth, deployer } = testEnv;

    expect(await configurator.setReserveFlashLoaning(weth.address, false));

    let wethFlashLoanEnabled = await helpersContract.getFlashLoanEnabled(weth.address);
    expect(wethFlashLoanEnabled).to.be.equal(false);

    let reserveData = await helpersContract.getReserveData(weth.address);

    const totalLiquidityBefore = reserveData.totalHToken;

    const flashBorrowedAmount = totalLiquidityBefore;

    await expect(
      pool.flashLoan(
        _mockFlashLoanReceiver.address,
        [weth.address],
        [flashBorrowedAmount],
        [0],
        _mockFlashLoanReceiver.address,
        '0x10',
        '0'
      )
    ).to.be.revertedWith(FLASHLOAN_DISABLED);

    expect(await configurator.setReserveFlashLoaning(weth.address, true))
      .to.emit(configurator, 'ReserveFlashLoaning')
      .withArgs(weth.address, true);

    wethFlashLoanEnabled = await helpersContract.getFlashLoanEnabled(weth.address);
    expect(wethFlashLoanEnabled).to.be.equal(true);
  });

  it('Takes WETH flashloan, does not return the funds with mode = 0 (revert expected)', async () => {
    const { pool, weth, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [ethers.utils.parseEther('0.8')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.reverted;
  });

  it('Takes WETH flashloan, simulating a receiver as EOA (revert expected)', async () => {
    const { pool, weth, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);
    await _mockFlashLoanReceiver.setSimulateEOA(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [ethers.utils.parseEther('0.8')],
          [0],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.revertedWith(INVALID_FLASHLOAN_EXECUTOR_RETURN);
  });

  it('Takes a WETH flashloan with an invalid mode (revert expected)', async () => {
    const { pool, weth, users } = testEnv;
    const caller = users[1];
    await _mockFlashLoanReceiver.setSimulateEOA(false);
    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    await expect(
      pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [ethers.utils.parseEther('0.8')],
          [4],
          caller.address,
          '0x10',
          '0'
        )
    ).to.be.reverted;
  });

  it('Caller deposits 1000 DAI as collateral, Takes WETH flashloan with mode = 2, does not return the funds. A variable loan for caller is created', async () => {
    const { dai, pool, weth, users, helpersContract } = testEnv;

    const caller = users[1];

    await dai
      .connect(caller.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(dai.address, '1000'));

    await dai.connect(caller.signer).approve(pool.address, MAX_UINT_AMOUNT);

    const amountToDeposit = await convertToCurrencyDecimals(dai.address, '1000');

    await pool.connect(caller.signer).deposit(dai.address, amountToDeposit, caller.address, '0');

    await _mockFlashLoanReceiver.setFailExecutionTransfer(true);

    let reserveData = await helpersContract.getReserveData(weth.address);

    let totalLiquidityBefore = reserveData.totalHToken;

    const borrowAmount = ethers.utils.parseEther('0.0571');

    expect(
      await pool
        .connect(caller.signer)
        .flashLoan(
          _mockFlashLoanReceiver.address,
          [weth.address],
          [borrowAmount],
          [2],
          caller.address,
          '0x10',
          '0'
        )
    )
      .to.emit(pool, 'FlashLoan')
      .withArgs(
        _mockFlashLoanReceiver.address,
        caller.address,
        weth.address,
        borrowAmount,
        2,
        0,
        0
      );

    const { variableDebtTokenAddress } = await helpersContract.getReserveTokensAddresses(
      weth.address
    );
    reserveData = await helpersContract.getReserveData(weth.address);

    const totalLiquidityAfter = reserveData.totalHToken;

    expect(totalLiquidityAfter).to.be.closeTo(totalLiquidityBefore, 2);

    const wethDebtToken = await getVariableDebtToken(variableDebtTokenAddress);
    const callerDebt = await wethDebtToken.balanceOf(caller.address);

    expect(callerDebt.toString()).to.be.equal('57100000000000000', 'Invalid user debt');
    // repays debt for later, so no interest accrue
    await weth
      .connect(caller.signer)
      ['mint(uint256)'](await convertToCurrencyDecimals(weth.address, '1000'));
    await weth.connect(caller.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(caller.signer).repay(weth.address, MAX_UINT_AMOUNT, 2, caller.address);
  });
});
