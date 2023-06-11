import { expect } from 'chai';
import { RateMode } from '../helpers/types';
import { MAX_UINT_AMOUNT, ONE_YEAR, ONE_ADDRESS } from '../helpers/constants';
import { makeSuite, TestEnv } from './helpers/make-suite';
import { convertToCurrencyDecimals } from '../helpers/contracts-helpers';
import './helpers/utils/wadraymath';
import { advanceTimeAndBlock } from 'lend-deploy';
import { percentMul, rayDiv, rayMul } from './helpers/utils/wadraymath';

makeSuite('Mint To Treasury', (testEnv: TestEnv) => {
  it('User 0 deposits 1000 HOPE. Borrower borrows 100 HOPE. Clock moved forward one year. Calculates and verifies the amount accrued to the treasury', async () => {
    const { users, pool, hope, helpersContract } = testEnv;

    const amountHOPEtoDeposit = await convertToCurrencyDecimals(hope.address, '1000');
    const amountHOPEtoBorrow = await convertToCurrencyDecimals(hope.address, '100');

    await expect(await hope.connect(users[0].signer)['mint(uint256)'](amountHOPEtoDeposit));

    // user 0 deposits 1000 HOPE
    await expect(await hope.connect(users[0].signer).approve(pool.address, MAX_UINT_AMOUNT));
    await expect(
      await pool
        .connect(users[0].signer)
        .deposit(hope.address, amountHOPEtoDeposit, users[0].address, '0')
    );

    await expect(
      await pool
        .connect(users[0].signer)
        .borrow(hope.address, amountHOPEtoBorrow, RateMode.Variable, '0', users[0].address)
    );

    const { reserveFactor } = await helpersContract.getReserveConfigurationData(hope.address);

    await advanceTimeAndBlock(parseInt(ONE_YEAR));

    await expect(await hope.connect(users[0].signer)['mint(uint256)'](amountHOPEtoDeposit));

    await expect(
      await pool
        .connect(users[0].signer)
        .deposit(hope.address, amountHOPEtoDeposit, users[0].address, '0')
    );

    const { liquidityIndex, variableBorrowIndex } = await pool.getReserveData(hope.address);

    const expectedAccruedToTreasury = rayDiv(
      percentMul(
        rayMul(amountHOPEtoBorrow, variableBorrowIndex).sub(amountHOPEtoBorrow),
        reserveFactor
      ),
      liquidityIndex
    );
    const { accruedToTreasury } = await pool.getReserveData(hope.address);
    expect(accruedToTreasury).to.be.closeTo(expectedAccruedToTreasury, 2);
  });

  it('Mints the accrued to the treasury', async () => {
    const { pool, hope, hHope } = testEnv;

    const feeToVault = ONE_ADDRESS;
    await pool.setFeeToVault(feeToVault);

    const treasuryAddress = await hHope.RESERVE_TREASURY_ADDRESS();
    const { accruedToTreasury } = await pool.getReserveData(hope.address);

    await expect(await pool.mintToTreasury([hope.address]));

    const normalizedIncome = await pool.getReserveNormalizedIncome(hope.address);
    const treasuryBalance = await hHope.balanceOf(treasuryAddress);

    const feeToVaultPercent = await pool.getFeeToVaultPercent();
    const feeToVaultBalance = await hope.balanceOf(feeToVault);

    const expectedFeeToVaultBalance = rayMul(accruedToTreasury, normalizedIncome)
      .mul(feeToVaultPercent)
      .div(10000);
    const expectedTreasuryBalance = rayMul(accruedToTreasury, normalizedIncome).sub(
      expectedFeeToVaultBalance
    );

    expect(treasuryBalance).to.be.closeTo(
      expectedTreasuryBalance,
      2,
      'Invalid treasury balance after minting'
    );

    expect(feeToVaultBalance).to.be.closeTo(
      expectedFeeToVaultBalance,
      2,
      'Invalid vault balance after minting'
    );
  });
});
