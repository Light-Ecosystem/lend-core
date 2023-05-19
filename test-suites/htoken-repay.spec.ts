import { MockHTokenRepayment } from './../types/mocks/tokens/MockHTokenRepayment';
import { MockHTokenRepayment__factory } from './../types/factories/mocks/tokens/MockHTokenRepayment__factory';
import {
  waitForTx,
  evmSnapshot,
  evmRevert,
  DefaultReserveInterestRateStrategy__factory,
  IStableDebtToken__factory,
  IVariableDebtToken__factory,
} from 'lend-deploy';
import { parseUnits } from '@ethersproject/units';
import { expect } from 'chai';
import { utils } from 'ethers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { setBlocktime, timeLatest } from '../helpers/misc-utils';
import { RateMode } from '../helpers/types';
import { TestEnv, makeSuite } from './helpers/make-suite';
import './helpers/utils/wadraymath';
import { rayMul } from './helpers/utils/wadraymath';

makeSuite('HToken: Repay', (testEnv: TestEnv) => {
  let snapShot: string;
  let hTokenRepayImpl: MockHTokenRepayment;

  before('User 0 deposits 100 DAI, user 1 deposits 1 WETH, borrows 50 DAI', async () => {
    const {
      weth,
      pool,
      dai,
      hDai,
      users: [user0, user1],
      deployer,
      configurator,
    } = testEnv;

    const daiAmount = utils.parseEther('100');
    const wethAmount = utils.parseEther('1');
    await waitForTx(await dai.connect(user0.signer)['mint(uint256)'](daiAmount));
    await waitForTx(await weth.connect(user1.signer)['mint(uint256)'](wethAmount));

    await waitForTx(await dai.connect(user0.signer).approve(pool.address, MAX_UINT_AMOUNT));
    await waitForTx(await weth.connect(user1.signer).approve(pool.address, MAX_UINT_AMOUNT));

    hTokenRepayImpl = await new MockHTokenRepayment__factory(deployer.signer).deploy(pool.address);

    await configurator.updateHToken({
      asset: dai.address,
      treasury: await hDai.RESERVE_TREASURY_ADDRESS(),
      incentivesController: await hDai.getIncentivesController(),
      name: await hDai.name(),
      symbol: await hDai.symbol(),
      implementation: hTokenRepayImpl.address,
      params: '0x',
    });

    expect(await pool.connect(user0.signer).deposit(dai.address, daiAmount, user0.address, 0));
    expect(await pool.connect(user1.signer).deposit(weth.address, wethAmount, user1.address, 0));

    expect(
      await pool.connect(user1.signer).borrow(dai.address, daiAmount.div(2), 2, 0, user1.address)
    );
  });

  beforeEach(async () => {
    snapShot = await evmSnapshot();
  });

  afterEach(async () => {
    await evmRevert(snapShot);
  });

  it('User 1 tries to repay using hTokens without actually holding aDAI', async () => {
    const {
      pool,
      dai,
      users: [, user1],
    } = testEnv;
    const repayAmount = utils.parseEther('25');

    await expect(pool.connect(user1.signer).repayWithHTokens(dai.address, repayAmount, 2)).to.be
      .reverted;
  });

  it('User 1 receives 25 aDAI from user 0, repays half of the debt', async () => {
    const {
      pool,
      dai,
      hDai,
      variableDebtDai,
      users: [user0, user1],
    } = testEnv;

    const repayAmount = utils.parseEther('25');

    await expect(await hDai.connect(user0.signer).transfer(user1.address, repayAmount));

    const time = await timeLatest();

    await setBlocktime(time.add(1).toNumber());

    const balanceBefore = await hDai.balanceOf(user1.address, { blockTag: 'pending' });
    const debtBefore = await variableDebtDai.balanceOf(user1.address, { blockTag: 'pending' });

    await expect(pool.connect(user1.signer).repayWithHTokens(dai.address, repayAmount, 2))
      .to.emit(pool, 'Repay')
      .withArgs(dai.address, user1.address, user1.address, repayAmount, true)
      .and.not.to.emit(hTokenRepayImpl.attach(hDai.address), 'MockRepayment');
    const balanceAfter = await hDai.balanceOf(user1.address);
    const debtAfter = await variableDebtDai.balanceOf(user1.address);

    expect(balanceAfter).to.be.closeTo(balanceBefore.sub(repayAmount), 2);
    expect(debtAfter).to.be.closeTo(debtBefore.sub(repayAmount), 2);
  });

  it('User 1 receives 25 aDAI from user 0, use all hDai to repay debt', async () => {
    const {
      pool,
      dai,
      hDai,
      variableDebtDai,
      users: [user0, user1],
    } = testEnv;

    const transferAmount = utils.parseEther('25');
    expect(await hDai.connect(user0.signer).transfer(user1.address, transferAmount));

    const time = await timeLatest();
    await setBlocktime(time.add(1).toNumber());

    const balanceBefore = await hDai.balanceOf(user1.address, { blockTag: 'pending' });
    expect(balanceBefore).to.be.gt(transferAmount);

    const debtBefore = await variableDebtDai.balanceOf(user1.address, { blockTag: 'pending' });

    const action = await pool
      .connect(user1.signer)
      .repayWithHTokens(dai.address, MAX_UINT_AMOUNT, 2);

    const tx = await waitForTx(action);

    const repayEventSignature = utils.keccak256(
      utils.toUtf8Bytes('Repay(address,address,address,uint256,bool)')
    );

    await expect(action).to.not.emit(hTokenRepayImpl.attach(hDai.address), 'MockRepayment');

    const rawRepayEvents = tx.logs.filter((log) => log.topics[0] === repayEventSignature);
    const parsedRepayEvent = pool.interface.parseLog(rawRepayEvents[0]);

    expect(parsedRepayEvent.args.useHTokens).to.be.true;
    expect(parsedRepayEvent.args.reserve).to.be.eq(dai.address);
    expect(parsedRepayEvent.args.repayer).to.be.eq(user1.address);
    expect(parsedRepayEvent.args.user).to.be.eq(user1.address);

    const repayAmount = parsedRepayEvent.args.amount;
    const balanceAfter = await hDai.balanceOf(user1.address);
    const debtAfter = await variableDebtDai.balanceOf(user1.address);

    expect(balanceAfter).to.be.eq(0);
    expect(debtAfter).to.be.closeTo(debtBefore.sub(repayAmount), 2);
  });

  it('User 1 receives 55 aDAI from user 0, repay all debt', async () => {
    const {
      pool,
      dai,
      hDai,
      variableDebtDai,
      users: [user0, user1],
    } = testEnv;

    const transferAmount = utils.parseEther('55');
    expect(await hDai.connect(user0.signer).transfer(user1.address, transferAmount));

    const time = await timeLatest();
    await setBlocktime(time.add(1).toNumber());

    const balanceBefore = await hDai.balanceOf(user1.address, { blockTag: 'pending' });
    const debtBefore = await variableDebtDai.balanceOf(user1.address, { blockTag: 'pending' });
    expect(debtBefore).to.be.gt(parseUnits('50', 18));

    const action = await pool
      .connect(user1.signer)
      .repayWithHTokens(dai.address, MAX_UINT_AMOUNT, 2);

    const tx = await waitForTx(action);

    await expect(action).to.not.emit(hTokenRepayImpl.attach(hDai.address), 'MockRepayment');

    const repayEventSignature = utils.keccak256(
      utils.toUtf8Bytes('Repay(address,address,address,uint256,bool)')
    );

    const rawRepayEvents = tx.logs.filter((log) => log.topics[0] === repayEventSignature);
    const parsedRepayEvent = pool.interface.parseLog(rawRepayEvents[0]);

    expect(parsedRepayEvent.args.useHTokens).to.be.true;
    expect(parsedRepayEvent.args.reserve).to.be.eq(dai.address);
    expect(parsedRepayEvent.args.repayer).to.be.eq(user1.address);
    expect(parsedRepayEvent.args.user).to.be.eq(user1.address);

    const repayAmount = parsedRepayEvent.args.amount;
    const balanceAfter = await hDai.balanceOf(user1.address);
    const debtAfter = await variableDebtDai.balanceOf(user1.address);

    expect(debtAfter).to.be.eq(0);
    expect(balanceAfter).to.be.eq(balanceBefore.sub(repayAmount));
  });

  it('Check interest rates after repaying with hTokens', async () => {
    const {
      weth,
      dai,
      hDai,
      pool,
      helpersContract,
      users: [user],
    } = testEnv;

    const depositAmount = parseUnits('1000', 18);
    await dai.connect(user.signer)['mint(uint256)'](depositAmount);
    await dai.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(dai.address, depositAmount, user.address, 0);

    const collateralAmount = parseUnits('100', 18);
    await weth.connect(user.signer)['mint(uint256)'](collateralAmount);
    await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    await pool.connect(user.signer).supply(weth.address, collateralAmount, user.address, 0);

    const borrowAmount = parseUnits('500', 18);
    await pool
      .connect(user.signer)
      .borrow(dai.address, borrowAmount, RateMode.Variable, 0, user.address);

    // Now we repay 250 with hTokens
    const repayAmount = parseUnits('250', 18);
    const action = await pool
      .connect(user.signer)
      .repayWithHTokens(dai.address, repayAmount, RateMode.Variable);

    await expect(action).to.not.emit(hTokenRepayImpl.attach(hDai.address), 'MockRepayment');

    const reserveData = await pool.getReserveData(dai.address);
    const strategy = DefaultReserveInterestRateStrategy__factory.connect(
      reserveData.interestRateStrategyAddress,
      user.signer
    );

    const stableDebtToken = IStableDebtToken__factory.connect(
      reserveData.stableDebtTokenAddress,
      user.signer
    );
    const stableDebtData = await stableDebtToken.getSupplyData();

    const variableDebtToken = IVariableDebtToken__factory.connect(
      reserveData.variableDebtTokenAddress,
      user.signer
    );
    const scaledTotalSupply = await variableDebtToken.scaledTotalSupply();
    const variableDebt = rayMul(
      scaledTotalSupply,
      await pool.getReserveNormalizedVariableDebt(dai.address)
    );

    const expectedRates = await strategy.calculateInterestRates({
      unbacked: 0,
      liquidityAdded: 0,
      liquidityTaken: 0,
      totalStableDebt: stableDebtData[1],
      totalVariableDebt: variableDebt,
      hToken: hDai.address,
      reserve: dai.address,
      reserveFactor: (await helpersContract.getReserveConfigurationData(dai.address)).reserveFactor,
      averageStableBorrowRate: stableDebtData[2],
    });

    expect(reserveData.currentLiquidityRate).to.be.eq(expectedRates[0]);
    expect(reserveData.currentStableBorrowRate).to.be.eq(expectedRates[1]);
    expect(reserveData.currentVariableBorrowRate).to.be.eq(expectedRates[2]);
  });
});
