import {
  evmSnapshot,
  evmRevert,
  advanceTimeAndBlock,
  ZERO_ADDRESS,
  MintableERC20__factory,
} from '@hopelend/deploy';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { TransactionReceipt } from '@ethersproject/providers';
import { MAX_UINT_AMOUNT } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { RateMode } from '../helpers/types';
import { Pool, HToken } from './../types';
import { makeSuite, SignerWithAddress, TestEnv } from './helpers/make-suite';
import {
  supply,
  transfer,
  withdraw,
  getHTokenEvent,
  transferFrom,
  printHTokenEvents,
} from './helpers/utils/tokenization-events';
import { percentMul } from './helpers/utils/wadraymath';

const DEBUG = false;

let balances = {
  balance: {},
};

const log = (str: string) => {
  if (DEBUG) console.log(str);
};

const printBalance = async (name: string, hToken: any, userAddress: string) => {
  console.log(
    name,
    'balanceOf',
    await ethers.utils.formatEther(await hToken.balanceOf(userAddress)),
    'scaledBalance',
    await ethers.utils.formatEther(await hToken.scaledBalanceOf(userAddress))
  );
};

const increaseSupplyIndex = async (
  pool: Pool,
  borrower: SignerWithAddress,
  collateral: string,
  assetToIncrease: string
) => {
  const collateralToken = MintableERC20__factory.connect(collateral, borrower.signer);
  const borrowingToken = MintableERC20__factory.connect(assetToIncrease, borrower.signer);

  await collateralToken
    .connect(borrower.signer)
    ['mint(uint256)'](await convertToCurrencyDecimals(collateralToken.address, '10000000'));
  await collateralToken.connect(borrower.signer).approve(pool.address, MAX_UINT_AMOUNT);
  await pool
    .connect(borrower.signer)
    .supply(
      collateral,
      await convertToCurrencyDecimals(collateral, '100000'),
      borrower.address,
      '0'
    );

  const { hTokenAddress } = await pool.getReserveData(assetToIncrease);
  const availableLiquidity = await borrowingToken.balanceOf(hTokenAddress);
  await pool
    .connect(borrower.signer)
    .borrow(
      assetToIncrease,
      percentMul(availableLiquidity, '20'),
      RateMode.Variable,
      0,
      borrower.address
    );

  await advanceTimeAndBlock(10000);
};

const updateBalances = (balances: any, hToken: HToken, receipt: TransactionReceipt) => {
  let events = getHTokenEvent(hToken, receipt, 'Transfer');
  for (const ev of events) {
    if (ev.from == ZERO_ADDRESS || ev.to == ZERO_ADDRESS) continue;
    balances.balance[ev.from] = balances.balance[ev.from]?.sub(ev.value);
    balances.balance[ev.to] = balances.balance[ev.to]?.add(ev.value);
  }
  events = getHTokenEvent(hToken, receipt, 'Mint');
  for (const ev of events) {
    balances.balance[ev.onBehalfOf] = balances.balance[ev.onBehalfOf]?.add(ev.value);
  }
  events = getHTokenEvent(hToken, receipt, 'Burn');
  for (const ev of events) {
    balances.balance[ev.from] = balances.balance[ev.from]?.sub(ev.value.add(ev.balanceIncrease));
    balances.balance[ev.from] = balances.balance[ev.from]?.add(ev.balanceIncrease);
  }
};

makeSuite('HToken: Events', (testEnv: TestEnv) => {
  let alice, bob, eve, borrower, borrower2;

  let snapId;

  before(async () => {
    const { users, pool, dai, weth } = testEnv;
    [alice, bob, eve, borrower, borrower2] = users;

    const amountToMint = await convertToCurrencyDecimals(dai.address, '10000000');
    const usersToInit = [alice, bob, eve, borrower, borrower2];
    for (const user of usersToInit) {
      await dai.connect(user.signer)['mint(uint256)'](amountToMint);
      await weth.connect(user.signer)['mint(uint256)'](amountToMint);
      await dai.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
      await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    }
  });

  beforeEach(async () => {
    snapId = await evmSnapshot();

    // Init balances
    balances = {
      balance: {
        [alice.address]: BigNumber.from(0),
        [bob.address]: BigNumber.from(0),
        [eve.address]: BigNumber.from(0),
      },
    };
  });

  afterEach(async () => {
    await evmRevert(snapId);
  });

  it('Alice and Bob supplies 1000, Alice transfer 500 to Bob, and withdraws 500 (without index change)', async () => {
    await testMultipleSupplyAndTransferAndWithdraw(false);
  });

  it('Alice and Bob supplies 1000, Alice transfer 500 to Bob, and withdraws 500 (with index change)', async () => {
    await testMultipleSupplyAndTransferAndWithdraw(true);
  });

  const testMultipleSupplyAndTransferAndWithdraw = async (indexChange: boolean) => {
    const { pool, dai, hDai, weth } = testEnv;

    let rcpt;
    let balanceTransferEv;
    let aliceBalanceBefore = await hDai.balanceOf(alice.address);
    let bobBalanceBefore = await hDai.balanceOf(bob.address);

    log('- Alice supplies 1000 DAI');
    rcpt = await supply(pool, alice, dai.address, '1000', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Bob supplies 1000 DAI');
    rcpt = await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice transfers 500 aDAI to Bob');
    const [fromScaledBefore, toScaledBefore] = await Promise.all([
      hDai.scaledBalanceOf(alice.address),
      hDai.scaledBalanceOf(bob.address),
    ]);
    rcpt = await transfer(pool, alice, dai.address, '500', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);
    balanceTransferEv = getHTokenEvent(hDai, rcpt, 'BalanceTransfer')[0];
    expect(await hDai.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore.sub(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );
    expect(await hDai.scaledBalanceOf(bob.address)).to.be.eq(
      toScaledBefore.add(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice withdraws 500 DAI to Bob');
    rcpt = await withdraw(pool, alice, dai.address, '500', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (DEBUG) {
      await printBalance('alice', hDai, alice.address);
      await printBalance('bob', hDai, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, dai.address, '1', alice.address, false);
    updateBalances(balances, hDai, rcpt);
    const aliceBalanceAfter = await hDai.balanceOf(alice.address);

    rcpt = await supply(pool, bob, dai.address, '1', bob.address, false);
    updateBalances(balances, hDai, rcpt);
    const bobBalanceAfter = await hDai.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  };

  it('Alice supplies 1000, supplies 200, transfers 100 out, withdraws 50 withdraws 100 to Bob, withdraws 200 (without index change)', async () => {
    await testMultipleSupplyAndWithdrawalsOnBehalf(false);
  });

  it('Alice supplies 1000, supplies 200, transfers 100 out, withdraws 50 withdraws 100 to Bob, withdraws 200 (with index change)', async () => {
    await testMultipleSupplyAndWithdrawalsOnBehalf(true);
  });

  const testMultipleSupplyAndWithdrawalsOnBehalf = async (indexChange: boolean) => {
    const { pool, dai, hDai, weth } = testEnv;

    let rcpt;
    let balanceTransferEv;
    let aliceBalanceBefore = await hDai.balanceOf(alice.address);
    let bobBalanceBefore = await hDai.balanceOf(bob.address);

    log('- Alice supplies 1000 DAI');
    rcpt = await supply(pool, alice, dai.address, '1000', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice supplies 200 DAI');
    rcpt = await supply(pool, alice, dai.address, '200', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice transfers 100 aDAI to Bob');
    const [fromScaledBefore, toScaledBefore] = await Promise.all([
      hDai.scaledBalanceOf(alice.address),
      hDai.scaledBalanceOf(bob.address),
    ]);
    rcpt = await transfer(pool, alice, dai.address, '100', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);
    balanceTransferEv = getHTokenEvent(hDai, rcpt, 'BalanceTransfer')[0];
    expect(await hDai.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore.sub(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );
    expect(await hDai.scaledBalanceOf(bob.address)).to.be.eq(
      toScaledBefore.add(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice withdraws 50 DAI');
    rcpt = await withdraw(pool, alice, dai.address, '50', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice withdraws 100 DAI to Bob');
    rcpt = await withdraw(pool, alice, dai.address, '100', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice withdraws 300 DAI');
    rcpt = await withdraw(pool, alice, dai.address, '300', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (DEBUG) {
      await printBalance('alice', hDai, alice.address);
      await printBalance('bob', hDai, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, dai.address, '1', alice.address, false);
    updateBalances(balances, hDai, rcpt);
    const aliceBalanceAfter = await hDai.balanceOf(alice.address);

    rcpt = await supply(pool, bob, dai.address, '1', bob.address, false);
    updateBalances(balances, hDai, rcpt);
    const bobBalanceAfter = await hDai.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  };

  it('Alice supplies 1000, supplies 200 to Bob, Bob supplies 100, Alice transfers 100 out, Alice withdraws 100, Alice withdraws 200 to Bob (without index change)', async () => {
    await testMultipleSupplyOnBehalfOfAndWithdrawals(false);
  });

  it('Alice supplies 1000, supplies 200 to Bob, Bob supplies 100, Alice transfers 100 out, Alice withdraws 100, Alice withdraws 200 to Bob (with index change)', async () => {
    await testMultipleSupplyOnBehalfOfAndWithdrawals(true);
  });

  const testMultipleSupplyOnBehalfOfAndWithdrawals = async (indexChange: boolean) => {
    const { pool, dai, hDai, weth } = testEnv;

    let rcpt;
    let balanceTransferEv;
    let aliceBalanceBefore = await hDai.balanceOf(alice.address);
    let bobBalanceBefore = await hDai.balanceOf(bob.address);

    log('- Alice supplies 1000 DAI');
    rcpt = await supply(pool, alice, dai.address, '1000', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice supplies 200 DAI to Bob');
    rcpt = await supply(pool, alice, dai.address, '200', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Bob supplies 100 DAI');
    rcpt = await supply(pool, bob, dai.address, '100', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice transfers 100 aDAI to Bob');
    const [fromScaledBefore, toScaledBefore] = await Promise.all([
      hDai.scaledBalanceOf(alice.address),
      hDai.scaledBalanceOf(bob.address),
    ]);
    rcpt = await transfer(pool, alice, dai.address, '100', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);
    balanceTransferEv = getHTokenEvent(hDai, rcpt, 'BalanceTransfer')[0];
    expect(await hDai.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore.sub(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );
    expect(await hDai.scaledBalanceOf(bob.address)).to.be.eq(
      toScaledBefore.add(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice withdraws 200 DAI to Bob');
    rcpt = await withdraw(pool, alice, dai.address, '200', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (DEBUG) {
      await printBalance('alice', hDai, alice.address);
      await printBalance('bob', hDai, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, dai.address, '1', alice.address, false);
    updateBalances(balances, hDai, rcpt);
    const aliceBalanceAfter = await hDai.balanceOf(alice.address);

    rcpt = await supply(pool, bob, dai.address, '1', bob.address, false);
    updateBalances(balances, hDai, rcpt);
    const bobBalanceAfter = await hDai.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  };

  it('Alice supplies 1000, transfers 100 to Bob, transfers 500 to itself, Bob transfers 500 from Alice to itself, withdraws 400 to Bob (without index change)', async () => {
    await testMultipleTransfersAndWithdrawals(false);
  });

  it('Alice supplies 1000, transfers 100 to Bob, transfers 500 to itself, Bob transfers 500 from Alice to itself, withdraws 400 to Bob  (with index change)', async () => {
    await testMultipleTransfersAndWithdrawals(true);
  });

  const testMultipleTransfersAndWithdrawals = async (indexChange: boolean) => {
    const { pool, dai, hDai, weth } = testEnv;

    let rcpt;
    let balanceTransferEv;
    let aliceBalanceBefore = await hDai.balanceOf(alice.address);
    let bobBalanceBefore = await hDai.balanceOf(bob.address);

    log('- Alice supplies 1000 DAI');
    rcpt = await supply(pool, alice, dai.address, '1000', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice transfers 100 DAI to Bob');
    let [fromScaledBefore, toScaledBefore] = await Promise.all([
      hDai.scaledBalanceOf(alice.address),
      hDai.scaledBalanceOf(bob.address),
    ]);
    rcpt = await transfer(pool, alice, dai.address, '100', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);
    balanceTransferEv = getHTokenEvent(hDai, rcpt, 'BalanceTransfer')[0];
    expect(await hDai.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore.sub(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );
    expect(await hDai.scaledBalanceOf(bob.address)).to.be.eq(
      toScaledBefore.add(balanceTransferEv.value),
      'Scaled balance emitted in BalanceTransfer event does not match'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice transfers 500 DAI to itself');
    fromScaledBefore = await hDai.scaledBalanceOf(alice.address);
    rcpt = await transfer(pool, alice, dai.address, '500', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);
    expect(await hDai.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore,
      'Scaled balance should remain the same'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Bob transfersFrom Alice 500 DAI to Alice');
    fromScaledBefore = await hDai.scaledBalanceOf(alice.address);
    expect(
      await hDai
        .connect(alice.signer)
        .approve(bob.address, await convertToCurrencyDecimals(dai.address, '500'))
    );
    rcpt = await transferFrom(pool, bob, alice.address, dai.address, '500', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);
    expect(await hDai.scaledBalanceOf(alice.address)).to.be.eq(
      fromScaledBefore,
      'Scaled balance should remain the same'
    );

    if (indexChange) {
      log('- Increase index due to great borrow of DAI');
      await increaseSupplyIndex(pool, borrower, weth.address, dai.address);
    }

    log('- Alice withdraws 400 DAI to Bob');
    rcpt = await withdraw(pool, alice, dai.address, '200', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (DEBUG) {
      await printBalance('alice', hDai, alice.address);
      await printBalance('bob', hDai, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, dai.address, '1', alice.address, false);
    updateBalances(balances, hDai, rcpt);
    const aliceBalanceAfter = await hDai.balanceOf(alice.address);

    rcpt = await supply(pool, bob, dai.address, '1', bob.address, false);
    updateBalances(balances, hDai, rcpt);
    const bobBalanceAfter = await hDai.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  };

  it('Alice supplies 300000, withdraws 200000 to Bob, withdraws 5 to Bob', async () => {
    const { pool, dai, hDai, weth } = testEnv;

    let rcpt;
    let aliceBalanceBefore = await hDai.balanceOf(alice.address);
    let bobBalanceBefore = await hDai.balanceOf(bob.address);

    log('- Alice supplies 300000 DAI');
    rcpt = await supply(pool, alice, dai.address, '300000', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    log('- Increase index due to great borrow of DAI');
    await increaseSupplyIndex(pool, borrower, weth.address, dai.address);

    log('- Alice withdraws 200000 DAI to Bob');
    rcpt = await withdraw(pool, alice, dai.address, '200000', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    log('- Increase index due to great borrow of DAI');
    await increaseSupplyIndex(pool, borrower, weth.address, dai.address);

    log('- Alice withdraws 5 DAI to Bob');
    rcpt = await withdraw(pool, alice, dai.address, '5', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (DEBUG) {
      await printBalance('alice', hDai, alice.address);
      await printBalance('bob', hDai, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, dai.address, '1', alice.address, false);
    updateBalances(balances, hDai, rcpt);
    const aliceBalanceAfter = await hDai.balanceOf(alice.address);

    rcpt = await supply(pool, bob, dai.address, '1', bob.address, false);
    updateBalances(balances, hDai, rcpt);
    const bobBalanceAfter = await hDai.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  });

  it('Bob supplies 1000, Alice supplies 200 on behalf of Bob, Bob withdraws 200 on behalf of Alice', async () => {
    const { pool, dai, hDai, weth } = testEnv;

    let rcpt;
    let aliceBalanceBefore = await hDai.balanceOf(alice.address);
    let bobBalanceBefore = await hDai.balanceOf(bob.address);

    log('- Bob supplies 1000 DAI');
    rcpt = await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    log('- Increase index due to great borrow of DAI');
    await increaseSupplyIndex(pool, borrower, weth.address, dai.address);

    log('- Alice supplies 200 DAI to Bob');
    rcpt = await supply(pool, alice, dai.address, '200', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    log('- Increase index due to great borrow of DAI');
    await increaseSupplyIndex(pool, borrower, weth.address, dai.address);

    log('- Bob withdraws 200 DAI to Alice');
    rcpt = await withdraw(pool, bob, dai.address, '200', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (DEBUG) {
      await printBalance('alice', hDai, alice.address);
      await printBalance('bob', hDai, bob.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, dai.address, '1', alice.address, false);
    updateBalances(balances, hDai, rcpt);
    const aliceBalanceAfter = await hDai.balanceOf(alice.address);

    rcpt = await supply(pool, bob, dai.address, '1', bob.address, false);
    updateBalances(balances, hDai, rcpt);
    const bobBalanceAfter = await hDai.balanceOf(bob.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
  });

  it('Alice supplies 1000 DAI and approves hDai to Bob, Bob transfers 500 to himself and 300 to Eve, index change, principal goes back to Alice', async () => {
    const { pool, dai, hDai, weth } = testEnv;

    let rcpt;
    let aliceBalanceBefore = await hDai.balanceOf(alice.address);
    let bobBalanceBefore = await hDai.balanceOf(bob.address);
    let eveBalanceBefore = await hDai.balanceOf(eve.address);

    log('- Alice supplies 1000 DAI');
    rcpt = await supply(pool, alice, dai.address, '1000', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    log('- Alice approves hDai to Bob');
    await hDai.connect(alice.signer).approve(bob.address, MAX_UINT_AMOUNT);

    log('- Bob transfers 500 hDai from Alice to himself');
    rcpt = await transferFrom(pool, bob, alice.address, dai.address, '500', bob.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    log('- Bob transfers 300 hDai from Alice to Eve');
    rcpt = await transferFrom(pool, bob, alice.address, dai.address, '300', eve.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    log('- Increase index due to great borrow of DAI');
    await increaseSupplyIndex(pool, borrower, weth.address, dai.address);

    log('- Bob transfers 500 back to Alice');
    rcpt = await transfer(pool, bob, dai.address, '500', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    log('- Eve transfers 500 back to Alice');
    rcpt = await transfer(pool, eve, dai.address, '300', alice.address, DEBUG);
    updateBalances(balances, hDai, rcpt);

    if (DEBUG) {
      await printBalance('alice', hDai, alice.address);
      await printBalance('bob', hDai, bob.address);
      await printBalance('eve', hDai, eve.address);
    }

    // Check final balances
    rcpt = await supply(pool, alice, dai.address, '1', alice.address, false);
    updateBalances(balances, hDai, rcpt);
    const aliceBalanceAfter = await hDai.balanceOf(alice.address);

    rcpt = await supply(pool, bob, dai.address, '1', bob.address, false);
    updateBalances(balances, hDai, rcpt);
    const bobBalanceAfter = await hDai.balanceOf(bob.address);

    rcpt = await supply(pool, eve, dai.address, '1', eve.address, false);
    updateBalances(balances, hDai, rcpt);
    const eveBalanceAfter = await hDai.balanceOf(eve.address);

    expect(aliceBalanceAfter).to.be.closeTo(
      aliceBalanceBefore.add(balances.balance[alice.address]),
      2
    );
    expect(bobBalanceAfter).to.be.closeTo(bobBalanceBefore.add(balances.balance[bob.address]), 2);
    expect(eveBalanceAfter).to.be.closeTo(eveBalanceBefore.add(balances.balance[eve.address]), 2);
  });
});
