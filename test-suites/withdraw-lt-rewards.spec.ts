import { expect } from 'chai';
import { MAX_UINT_AMOUNT, ONE_ADDRESS } from '../helpers/constants';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import './helpers/utils/wadraymath';
import { advanceTimeAndBlock } from '@hopelend/deploy';

makeSuite('Withdraw lt reward from hstHOPE', (testEnv: TestEnv) => {
  it('user supply stHOPE, admin withdraw lt rewards', async () => {

    const { users, pool, lt, hope, stakingHOPE, hstHOPE } = testEnv;
    const amountHOPEtoDeposit = await convertToCurrencyDecimals(hope.address, '1000');

    await expect(await hope.connect(users[0].signer)['mint(uint256)'](amountHOPEtoDeposit));

    await hope.connect(users[0].signer).approve(stakingHOPE.address, MAX_UINT_AMOUNT);
    await stakingHOPE.connect(users[0].signer).staking(amountHOPEtoDeposit, 0, 0, "0x01");
              
    // user 0 deposits 1000 stHOPE
    await expect(await stakingHOPE.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT));
    await expect(
      await pool
        .connect(users[0].signer).deposit(stakingHOPE.address, amountHOPEtoDeposit, users[0].address, '0')
    );

    // here, hstHOPE hold stHOPE now
    await advanceTimeAndBlock(parseInt('6048000'));
    await hstHOPE.withdrawLTRewards(stakingHOPE.address, ONE_ADDRESS);
    const balanceOfOneAddress = await lt.balanceOf(ONE_ADDRESS);
    expect(balanceOfOneAddress).to.be.gt(0);
  });
});
