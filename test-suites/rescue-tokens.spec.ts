import { expect } from 'chai';
import { utils } from 'ethers';
import { ProtocolErrors } from '../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { evmSnapshot, evmRevert, ONE_ADDRESS } from '@hopelend/deploy';
import { deployMintableERC20 } from '@hopelend/deploy/dist/helpers/contract-deployments';
import { MintableERC20 } from './../types';

makeSuite('Rescue tokens', (testEnv: TestEnv) => {
  const { CALLER_NOT_POOL_ADMIN, CALLER_MUST_BE_POOL, UNDERLYING_CANNOT_BE_RESCUED } =
    ProtocolErrors;

  let snap: string;

  beforeEach(async () => {
    snap = await evmSnapshot();
  });

  afterEach(async () => {
    await evmRevert(snap);
  });

  it('User tries to rescue tokens from Pool (revert expected)', async () => {
    const {
      pool,
      usdc,
      users: [rescuer],
    } = testEnv;

    const amount = 1;
    await expect(
      pool.connect(rescuer.signer).rescueTokens(usdc.address, rescuer.address, amount)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('PoolAdmin rescue tokens from Pool', async () => {
    const {
      poolAdmin,
      pool,
      usdc,
      users: [locker],
    } = testEnv;

    const amountToLock = utils.parseUnits('10', 18);

    // Lock
    await usdc['mint(address,uint256)'](locker.address, amountToLock);
    await usdc.connect(locker.signer).transfer(pool.address, amountToLock);

    const lockerBalanceBefore = await usdc.balanceOf(locker.address);
    const poolBalanceBefore = await usdc.balanceOf(pool.address);

    expect(
      await pool.connect(poolAdmin.signer).rescueTokens(usdc.address, locker.address, amountToLock)
    );

    const poolBalanceAfter = await usdc.balanceOf(pool.address);
    expect(poolBalanceBefore).to.be.eq(poolBalanceAfter.add(amountToLock));
    const lockerBalanceAfter = await usdc.balanceOf(locker.address);
    expect(lockerBalanceBefore).to.be.eq(lockerBalanceAfter.sub(amountToLock));
  });

  it('User tries to rescue tokens from HToken (revert expected)', async () => {
    const {
      usdc,
      hDai,
      users: [rescuer],
    } = testEnv;

    const amount = 1;
    await expect(
      hDai.connect(rescuer.signer).rescueTokens(usdc.address, rescuer.address, amount)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('User tries to rescue tokens of underlying from HToken (revert expected)', async () => {
    const {
      hDai,
      dai,
      users: [rescuer],
    } = testEnv;

    const amount = 1;
    await expect(
      hDai.connect(rescuer.signer).rescueTokens(dai.address, rescuer.address, amount)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });

  it('PoolAdmin tries to rescue tokens of underlying from HToken (revert expected)', async () => {
    const {
      poolAdmin,
      hDai,
      dai,
      users: [rescuer],
    } = testEnv;

    const amount = 1;
    await expect(
      hDai.connect(poolAdmin.signer).rescueTokens(dai.address, rescuer.address, amount)
    ).to.be.revertedWith(UNDERLYING_CANNOT_BE_RESCUED);
  });

  it('PoolAdmin rescue tokens from HToken', async () => {
    const {
      poolAdmin,
      dai,
      usdc,
      hDai,
      users: [locker],
    } = testEnv;

    const amountToLock = utils.parseUnits('10', 18);

    // Lock
    await usdc['mint(address,uint256)'](locker.address, amountToLock);
    await usdc.connect(locker.signer).transfer(hDai.address, amountToLock);

    const lockerBalanceBefore = await usdc.balanceOf(locker.address);
    const hTokenBalanceBefore = await usdc.balanceOf(hDai.address);

    expect(
      await hDai.connect(poolAdmin.signer).rescueTokens(usdc.address, locker.address, amountToLock)
    );

    const hTokenBalanceAfter = await usdc.balanceOf(hDai.address);
    expect(hTokenBalanceBefore).to.be.eq(hTokenBalanceAfter.add(amountToLock));
    const lockerBalanceAfter = await usdc.balanceOf(locker.address);
    expect(lockerBalanceBefore).to.be.eq(lockerBalanceAfter.sub(amountToLock));
  });
});
