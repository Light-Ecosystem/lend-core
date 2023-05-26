import { DelegationAwareHToken, MintableDelegationERC20 } from './../types';
import { expect } from 'chai';
import { ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors } from '../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import {
  deployMintableDelegationERC20,
  deployDelegationAwareHToken,
} from 'lend-deploy/dist/helpers/contract-deployments';

makeSuite('HToken: DelegationAwareHToken', (testEnv: TestEnv) => {
  let delegationHToken = <DelegationAwareHToken>{};
  let delegationERC20 = <MintableDelegationERC20>{};

  it('Deploys a new MintableDelegationERC20 and a DelegationAwareHToken', async () => {
    const { pool } = testEnv;

    delegationERC20 = await deployMintableDelegationERC20(['DEL', 'DEL', '18']);

    delegationHToken = await deployDelegationAwareHToken([
      pool.address,
      delegationERC20.address,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      'aDEL',
      'aDEL',
    ]);
  });

  it('Tries to delegate with the caller not being the HopeLend admin (revert expected)', async () => {
    const { users } = testEnv;

    await expect(
      delegationHToken.connect(users[1].signer).delegateUnderlyingTo(users[2].address)
    ).to.be.revertedWith(ProtocolErrors.CALLER_NOT_POOL_ADMIN);
  });

  it('Delegates to user 2', async () => {
    const { users } = testEnv;

    expect(await delegationHToken.delegateUnderlyingTo(users[2].address))
      .to.emit(delegationHToken, 'DelegateUnderlyingTo')
      .withArgs(users[2].address);

    const delegateeAddress = await delegationERC20.delegatee();

    expect(delegateeAddress).to.be.equal(users[2].address);
  });
});
