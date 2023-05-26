import { expect } from 'chai';
import { BigNumberish } from 'ethers';
import { MAX_UINT_AMOUNT, ZERO_ADDRESS } from '../helpers/constants';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import { ProtocolErrors } from '../helpers/types';
import { makeSuite } from './helpers/make-suite';
import { parseUnits } from 'ethers/lib/utils';

makeSuite('LendingGauge', (testEnv) => {
  const {
    PARAMETER_ADDRESS_NOT_ZERO,
    CALLER_NOT_POOL_ADMIN,
    INVALID_PHASES_LENGTH,
    LENDING_GAUGE_PERCENTAGE_NOT_MATCH,
  } = ProtocolErrors;
  let alice, bob;

  const correctInputParams: {
    startPercentage: BigNumberish;
    endPercentage: BigNumberish;
    k: BigNumberish;
    b: BigNumberish;
  }[] = [
    {
      startPercentage: parseUnits('0', 0),
      endPercentage: parseUnits('0.35', 27),
      k: parseUnits('2', 27),
      b: parseUnits('0', 0),
    },
    {
      startPercentage: parseUnits('0.35', 27),
      endPercentage: parseUnits('0.65', 27),
      k: parseUnits('0', 0),
      b: parseUnits('0.7', 27),
    },
    {
      startPercentage: parseUnits('0.65', 27),
      endPercentage: parseUnits('0.8', 27),
      k: parseUnits('-4.666666666666667', 27),
      b: parseUnits('3.7333333333333334', 27),
    },
    {
      startPercentage: parseUnits('0.8', 27),
      endPercentage: parseUnits('1', 27),
      k: parseUnits('0', 0),
      b: parseUnits('0', 0),
    },
  ];

  before(async () => {
    const { users, pool, dai, weth } = testEnv;
    [alice, bob] = users;

    const amountToMint = await convertToCurrencyDecimals(dai.address, '10000000');
    const usersToInit = [alice, bob];
    for (const user of usersToInit) {
      await dai.connect(user.signer)['mint(uint256)'](amountToMint);
      await weth.connect(user.signer)['mint(uint256)'](amountToMint);
      await dai.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
      await weth.connect(user.signer).approve(pool.address, MAX_UINT_AMOUNT);
    }
  });

  it('Initialize will revert because address is zero', async () => {
    const { lendingGauge } = testEnv;
    await expect(
      lendingGauge.initialize(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS)
    ).to.be.revertedWith(PARAMETER_ADDRESS_NOT_ZERO);
  });
  it('Add phase will revert because caller not pool admin', async () => {
    const { daiLendingGauge } = testEnv;
    await expect(daiLendingGauge.connect(alice.signer).addPhases([])).to.be.revertedWith(
      CALLER_NOT_POOL_ADMIN
    );
  });

  it('Add phase will revert because length is invalid', async () => {
    const { daiLendingGauge } = testEnv;
    let inputParams: {
      startPercentage: BigNumberish;
      endPercentage: BigNumberish;
      k: BigNumberish;
      b: BigNumberish;
    }[] = correctInputParams.slice(0, 2);
    await expect(daiLendingGauge.addPhases(inputParams)).to.be.revertedWith(INVALID_PHASES_LENGTH);
    inputParams = inputParams
      .concat(correctInputParams)
      .concat(correctInputParams)
      .concat(correctInputParams);
    await expect(daiLendingGauge.addPhases(inputParams)).to.be.revertedWith(INVALID_PHASES_LENGTH);
  });

  it('Add phase will revert because percentage config not match', async () => {
    const { daiLendingGauge } = testEnv;
    let inputParams: {
      startPercentage: BigNumberish;
      endPercentage: BigNumberish;
      k: BigNumberish;
      b: BigNumberish;
    }[] = [
      {
        startPercentage: parseUnits('0.35', 27),
        endPercentage: parseUnits('0', 0),
        k: parseUnits('2', 27),
        b: parseUnits('0', 0),
      },
      {
        startPercentage: parseUnits('0.35', 27),
        endPercentage: parseUnits('0.65', 27),
        k: parseUnits('0', 0),
        b: parseUnits('0.7', 27),
      },
      {
        startPercentage: parseUnits('0.65', 27),
        endPercentage: parseUnits('0.8', 27),
        k: parseUnits('-4.666666666666667', 27),
        b: parseUnits('3.7333333333333334', 27),
      },
      {
        startPercentage: parseUnits('0.8', 27),
        endPercentage: parseUnits('1', 27),
        k: parseUnits('0', 0),
        b: parseUnits('0', 0),
      },
    ];
    await expect(daiLendingGauge.addPhases(inputParams)).to.be.revertedWith(
      LENDING_GAUGE_PERCENTAGE_NOT_MATCH
    );
    inputParams = correctInputParams.concat(correctInputParams);
    await expect(daiLendingGauge.addPhases(inputParams)).to.be.revertedWith(
      LENDING_GAUGE_PERCENTAGE_NOT_MATCH
    );
  });
});
