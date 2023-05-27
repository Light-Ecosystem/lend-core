import { expect } from 'chai';
import { ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors } from '../helpers/types';
import { makeSuite } from './helpers/make-suite';
import { evmRevert, evmSnapshot } from 'lend-deploy';
import { BigNumberish } from 'ethers';

makeSuite('LendingGauge: Checkpoint', (testEnv) => {
  const { CALLER_MUST_BE_LENDING_GAUGE } = ProtocolErrors;
  let alice, bob, eve;
  let snapId;

  const mockCheckpointParams: {
    period: BigNumberish;
    periodTime: BigNumberish;
    rate: BigNumberish;
    newRate: BigNumberish;
    prevFutureEpoch: BigNumberish;
  } = {
    period: 0,
    periodTime: 0,
    rate: 0,
    newRate: 0,
    prevFutureEpoch: 0,
  };

  before(async () => {
    const { users } = testEnv;
    [alice, bob, eve] = users;
  });

  beforeEach(async () => {
    snapId = await evmSnapshot();
  });

  afterEach(async () => {
    await evmRevert(snapId);
  });

  it('AbsGauge checkpoint will revert because caller is not lending gauge', async () => {
    const { hDai } = testEnv;
    await expect(hDai.checkpoint(alice.address, 10, mockCheckpointParams)).to.be.revertedWith(
      CALLER_MUST_BE_LENDING_GAUGE
    );
  });
  it('AbsGauge updateLiquidityLimit will revert because caller is not lending gauge', async () => {
    const { hDai } = testEnv;
    await expect(hDai.updateLiquidityLimit(alice.address)).to.be.revertedWith(
      CALLER_MUST_BE_LENDING_GAUGE
    );
  });
});
