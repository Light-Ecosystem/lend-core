import { expect } from 'chai';
import { MAX_UINT_AMOUNT, PERCENTAGE_FACTOR, ZERO_ADDRESS, oneEther } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors, RateMode } from '../helpers/types';
import { makeSuite } from './helpers/make-suite';
import { evmRevert, evmSnapshot, increaseTime } from '@hopelend/deploy';
import { percentMul } from './helpers/utils/wadraymath';
import { supply, variableBorrow } from './helpers/utils/tokenization-events';

const DEBUG = false;

makeSuite('LendingGauge: Rewards', (testEnv) => {
  let RATE;
  let WEIGHT;
  const TIME_INCREASE = 30;
  const WEEK = 86400 * 7;

  let alice, bob, eve;
  let snapId;

  before(async () => {
    const { users, pool, dai, weth, gaugeController, lt, daiLendingGauge } = testEnv;
    [alice, bob, eve] = users;
    RATE = await lt.rate();
    WEIGHT = (
      await gaugeController.gaugeRelativeWeight(
        daiLendingGauge.address,
        Date.parse(new Date().toString()) / 1000 + WEEK
      )
    )
      .mul(PERCENTAGE_FACTOR)
      .div(oneEther);

    const amountToMint = await convertToCurrencyDecimals(dai.address, '10000000');
    const usersToInit = [alice, bob, eve];
    for (const user of usersToInit) {
      await dai.connect(user.signer)['mint(uint256)'](amountToMint);
      await weth.connect(user.signer)['mint(uint256)'](amountToMint);
      await dai.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
      await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    }
  });

  beforeEach(async () => {
    snapId = await evmSnapshot();
  });

  afterEach(async () => {
    await evmRevert(snapId);
  });

  it('Rewards verify when first supply', async () => {
    const { pool, dai, daiLendingGauge } = testEnv;
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await daiLendingGauge.connect(bob.signer).userCheckpoint(bob.address);
    if (DEBUG) console.log('bob rewards: ', await daiLendingGauge.integrateFraction(bob.address));
    expect(await daiLendingGauge.integrateFraction(bob.address)).gte(
      percentMul(RATE, WEIGHT).mul(TIME_INCREASE)
    );
  });
  it('Rewards verify when phase 1', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '100', alice.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await daiLendingGauge.connect(bob.signer).userCheckpoint(bob.address);
    await daiLendingGauge.connect(alice.signer).userCheckpoint(alice.address);
    if (DEBUG) console.log('bob rewards: ', await daiLendingGauge.integrateFraction(bob.address));

    if (DEBUG)
      console.log('alice rewards: ', await daiLendingGauge.integrateFraction(alice.address));
    expect(await daiLendingGauge.integrateFraction(bob.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 8000).mul(TIME_INCREASE)
    );
    expect(await daiLendingGauge.integrateFraction(alice.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 2000).mul(TIME_INCREASE)
    );
  });
  it('Rewards verify when phase 2', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '360', alice.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await daiLendingGauge.connect(bob.signer).userCheckpoint(bob.address);
    await daiLendingGauge.connect(alice.signer).userCheckpoint(alice.address);
    if (DEBUG) console.log('bob rewards: ', await daiLendingGauge.integrateFraction(bob.address));

    if (DEBUG)
      console.log('alice rewards: ', await daiLendingGauge.integrateFraction(alice.address));
    expect(await daiLendingGauge.integrateFraction(bob.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 3000).mul(TIME_INCREASE)
    );
    expect(await daiLendingGauge.integrateFraction(alice.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 7000).mul(TIME_INCREASE)
    );
  });
  it('Rewards verify when phase 3', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '660', alice.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await daiLendingGauge.connect(bob.signer).userCheckpoint(bob.address);
    await daiLendingGauge.connect(alice.signer).userCheckpoint(alice.address);
    if (DEBUG) console.log('bob rewards: ', await daiLendingGauge.integrateFraction(bob.address));

    if (DEBUG)
      console.log('alice rewards: ', await daiLendingGauge.integrateFraction(alice.address));
    expect(await daiLendingGauge.integrateFraction(bob.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 3467).mul(TIME_INCREASE)
    );
    expect(await daiLendingGauge.integrateFraction(alice.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 6533).mul(TIME_INCREASE)
    );
  });
  it('Rewards verify when phase 4', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '801', alice.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await daiLendingGauge.connect(bob.signer).userCheckpoint(bob.address);
    await daiLendingGauge.connect(alice.signer).userCheckpoint(alice.address);
    if (DEBUG) console.log('bob rewards: ', await daiLendingGauge.integrateFraction(bob.address));

    if (DEBUG)
      console.log('alice rewards: ', await daiLendingGauge.integrateFraction(alice.address));
    expect(await daiLendingGauge.integrateFraction(bob.address)).to.gte(
      percentMul(RATE, WEIGHT).mul(TIME_INCREASE)
    );
    expect(await daiLendingGauge.integrateFraction(alice.address)).to.be.equal(0);
  });
  it('Rewards verify when phase 2 - 3', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '360', alice.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await variableBorrow(pool, alice, dai.address, '300', alice.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await daiLendingGauge.connect(bob.signer).userCheckpoint(bob.address);
    await daiLendingGauge.connect(alice.signer).userCheckpoint(alice.address);
    if (DEBUG) console.log('bob rewards: ', await daiLendingGauge.integrateFraction(bob.address));

    if (DEBUG)
      console.log('alice rewards: ', await daiLendingGauge.integrateFraction(alice.address));
    expect(await daiLendingGauge.integrateFraction(bob.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 3000)
        .mul(TIME_INCREASE)
        .add(percentMul(percentMul(RATE, WEIGHT), 3467).mul(TIME_INCREASE))
    );
    expect(await daiLendingGauge.integrateFraction(alice.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 7000)
        .mul(TIME_INCREASE)
        .add(percentMul(percentMul(RATE, WEIGHT), 6533).mul(TIME_INCREASE))
    );
  });
  it('Rewards verify when phase 2 - 1', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '360', alice.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await pool
      .connect(alice.signer)
      .repay(
        dai.address,
        convertToCurrencyDecimals(dai.address, '60'),
        RateMode.Variable,
        alice.address
      );
    await increaseTime(TIME_INCREASE);
    await daiLendingGauge.connect(bob.signer).userCheckpoint(bob.address);
    await daiLendingGauge.connect(alice.signer).userCheckpoint(alice.address);
    if (DEBUG) console.log('bob rewards: ', await daiLendingGauge.integrateFraction(bob.address));

    if (DEBUG)
      console.log('alice rewards: ', await daiLendingGauge.integrateFraction(alice.address));
    expect(await daiLendingGauge.integrateFraction(bob.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 3000)
        .mul(TIME_INCREASE)
        .add(percentMul(percentMul(RATE, WEIGHT), 4000).mul(TIME_INCREASE))
    );
    expect(await daiLendingGauge.integrateFraction(alice.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 7000)
        .mul(TIME_INCREASE)
        .add(percentMul(percentMul(RATE, WEIGHT), 6000).mul(TIME_INCREASE))
    );
  });
  it('Rewards verify when phase 2 - 3 with two users supply', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await supply(pool, eve, dai.address, '1000', eve.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '720', alice.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await variableBorrow(pool, alice, dai.address, '600', alice.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await daiLendingGauge.connect(bob.signer).userCheckpoint(bob.address);
    await daiLendingGauge.connect(alice.signer).userCheckpoint(alice.address);
    await daiLendingGauge.connect(eve.signer).userCheckpoint(eve.address);
    if (DEBUG) console.log('bob rewards: ', await daiLendingGauge.integrateFraction(bob.address));

    if (DEBUG)
      console.log('alice rewards: ', await daiLendingGauge.integrateFraction(alice.address));
    if (DEBUG) console.log('eve rewards: ', await daiLendingGauge.integrateFraction(eve.address));
    expect(await daiLendingGauge.integrateFraction(bob.address)).to.gte(
      percentMul(percentMul(percentMul(RATE, WEIGHT), 3000), 5000)
        .mul(TIME_INCREASE)
        .add(percentMul(percentMul(percentMul(RATE, WEIGHT), 3467), 5000).mul(TIME_INCREASE))
    );
    expect(await daiLendingGauge.integrateFraction(alice.address)).to.gte(
      percentMul(percentMul(RATE, WEIGHT), 7000)
        .mul(TIME_INCREASE)
        .add(percentMul(percentMul(RATE, WEIGHT), 6533).mul(TIME_INCREASE))
    );
    expect(await daiLendingGauge.integrateFraction(eve.address)).to.gte(
      percentMul(percentMul(percentMul(RATE, WEIGHT), 3000), 5000)
        .mul(TIME_INCREASE)
        .add(percentMul(percentMul(percentMul(RATE, WEIGHT), 3467), 5000).mul(TIME_INCREASE))
    );
  });
  it('Rewards verify when first supply - bob transfer to eve', async () => {
    const { pool, dai, daiLendingGauge, hDai } = testEnv;
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await hDai.connect(bob.signer).transfer(eve.address, await hDai.balanceOf(bob.address));
    await increaseTime(TIME_INCREASE);
    await daiLendingGauge.connect(bob.signer).userCheckpoint(bob.address);
    await daiLendingGauge.connect(eve.signer).userCheckpoint(eve.address);
    if (DEBUG) console.log('bob rewards: ', await daiLendingGauge.integrateFraction(bob.address));
    if (DEBUG) console.log('eve rewards: ', await daiLendingGauge.integrateFraction(eve.address));
    expect(await daiLendingGauge.integrateFraction(bob.address)).gte(0);
    expect(await daiLendingGauge.integrateFraction(eve.address)).gte(
      percentMul(RATE, WEIGHT).mul(TIME_INCREASE)
    );
  });
  it('Minter claim rewards', async () => {
    const { pool, dai, weth, daiLendingGauge, minter, lt } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '100', alice.address, DEBUG);
    await increaseTime(TIME_INCREASE);
    await daiLendingGauge.connect(bob.signer).userCheckpoint(bob.address);
    await daiLendingGauge.connect(alice.signer).userCheckpoint(alice.address);
    if (DEBUG) console.log('bob rewards: ', await daiLendingGauge.integrateFraction(bob.address));

    if (DEBUG)
      console.log('alice rewards: ', await daiLendingGauge.integrateFraction(alice.address));

    expect(await minter.minted(bob.address, daiLendingGauge.address)).to.be.equal(0);
    await minter.connect(bob.signer).mint(daiLendingGauge.address);
    expect(await minter.minted(bob.address, daiLendingGauge.address)).gt(0);
    expect(await lt.balanceOf(bob.address)).gt(0);
  });
});
