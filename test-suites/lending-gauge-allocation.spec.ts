import { expect } from 'chai';
import { BigNumber } from 'ethers';
import { MAX_UINT_AMOUNT, RAY } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { RateMode } from '../helpers/types';
import { makeSuite } from './helpers/make-suite';
import { evmRevert, evmSnapshot } from 'lend-deploy';
import { percentMul } from './helpers/utils/wadraymath';
import { supply, variableBorrow } from './helpers/utils/tokenization-events';

const DEBUG = false;

makeSuite('LendingGauge: Allocation', (testEnv) => {
  let alice, bob, eve;
  let snapId;

  before(async () => {
    const { users, pool, dai, weth } = testEnv;
    [alice, bob, eve] = users;

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

  it('Borrow allocation verify when first supply', async () => {
    const { pool, dai, daiLendingGauge } = testEnv;
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    expect(await daiLendingGauge.borrowAllocation()).to.be.equal(0);
  });
  it('Borrow allocation verify when phase 1', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '100', alice.address, DEBUG);
    expect(await daiLendingGauge.borrowAllocation()).to.be.equal(
      percentMul(BigNumber.from(RAY), 2000)
    );
  });
  it('Borrow allocation verify when phase 2', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '360', alice.address, DEBUG);
    expect(await daiLendingGauge.borrowAllocation()).to.be.equal(
      percentMul(BigNumber.from(RAY), 7000)
    );
  });
  it('Borrow allocation verify when phase 3', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '660', alice.address, DEBUG);
    expect(await daiLendingGauge.borrowAllocation()).to.be.equal(
      BigNumber.from('653333333333337400000000000')
    );
  });
  it('Borrow allocation verify when phase 4', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '801', alice.address, DEBUG);
    expect(await daiLendingGauge.borrowAllocation()).to.be.equal(
      percentMul(BigNumber.from(RAY), 0)
    );
  });
  it('Borrow allocation verify when phase 2 - 3', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '360', alice.address, DEBUG);
    expect(await daiLendingGauge.borrowAllocation()).to.be.equal(
      percentMul(BigNumber.from(RAY), 7000)
    );
    await variableBorrow(pool, alice, dai.address, '300', alice.address, DEBUG);
    if (DEBUG) console.log('borrow allocation: ', await daiLendingGauge.borrowAllocation());
    expect(await daiLendingGauge.borrowAllocation()).to.gt(
      BigNumber.from('65330000000000000000000000')
    );
  });
  it('Borrow allocation verify when phase 2 - 1', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '360', alice.address, DEBUG);
    expect(await daiLendingGauge.borrowAllocation()).to.be.equal(
      percentMul(BigNumber.from(RAY), 7000)
    );
    await pool
      .connect(alice.signer)
      .repay(
        dai.address,
        convertToCurrencyDecimals(dai.address, '60'),
        RateMode.Variable,
        alice.address
      );
    if (DEBUG) console.log('borrow allocation: ', await daiLendingGauge.borrowAllocation());
    expect(await daiLendingGauge.borrowAllocation()).to.gt(percentMul(BigNumber.from(RAY), 6000));
  });
  it('Borrow allocation verify when phase 2 - 3 with two users supply', async () => {
    const { pool, dai, weth, daiLendingGauge } = testEnv;
    await supply(pool, alice, weth.address, '1000', alice.address, DEBUG);
    await supply(pool, bob, dai.address, '1000', bob.address, DEBUG);
    await supply(pool, eve, dai.address, '1000', eve.address, DEBUG);
    await variableBorrow(pool, alice, dai.address, '720', alice.address, DEBUG);
    expect(await daiLendingGauge.borrowAllocation()).to.be.equal(
      percentMul(BigNumber.from(RAY), 7000)
    );
    await variableBorrow(pool, alice, dai.address, '600', alice.address, DEBUG);
    if (DEBUG) console.log('borrow allocation: ', await daiLendingGauge.borrowAllocation());
    expect(await daiLendingGauge.borrowAllocation()).to.gt(
      BigNumber.from('65330000000000000000000000')
    );
  });
});
