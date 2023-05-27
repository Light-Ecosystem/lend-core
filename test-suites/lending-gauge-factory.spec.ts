import { expect } from 'chai';
import { ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors } from '../helpers/types';
import { makeSuite } from './helpers/make-suite';
import { evmRevert, evmSnapshot } from 'lend-deploy';

makeSuite('LendingGauge: Factory', (testEnv) => {
  const { PARAMETER_ADDRESS_NOT_ZERO, CALLER_NOT_POOL_ADMIN } = ProtocolErrors;
  let alice, bob, eve;
  let snapId;

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

  it('GaugeFactory grant operator will revert because operator address is zero', async () => {
    const { gaugeFactory } = testEnv;
    await expect(gaugeFactory.addOperator(ZERO_ADDRESS)).to.be.revertedWith(
      PARAMETER_ADDRESS_NOT_ZERO
    );
  });
  it('GaugeFactory grant operator will revert because caller is not pool admin', async () => {
    const { gaugeFactory } = testEnv;
    await expect(gaugeFactory.connect(bob.signer).addOperator(alice.address)).to.be.revertedWith(
      CALLER_NOT_POOL_ADMIN
    );
  });
  it('GaugeFactory grant operator success', async () => {
    const { gaugeFactory } = testEnv;
    expect(await gaugeFactory.isOperator(alice.address)).to.be.false;
    expect(await gaugeFactory.isOperator(eve.address)).to.be.false;
    await gaugeFactory.addOperator(alice.address);
    await gaugeFactory.addOperator(eve.address);
    expect(await gaugeFactory.isOperator(alice.address)).to.be.true;
    expect(await gaugeFactory.isOperator(eve.address)).to.be.true;
  });
  it('GaugeFactory revoke operator will revert because operator address is zero', async () => {
    const { gaugeFactory } = testEnv;
    await expect(gaugeFactory.removeOperator(ZERO_ADDRESS)).to.be.revertedWith(
      PARAMETER_ADDRESS_NOT_ZERO
    );
  });
  it('GaugeFactory revoke operator will revert because caller is not pool admin', async () => {
    const { gaugeFactory } = testEnv;
    await expect(gaugeFactory.connect(bob.signer).removeOperator(alice.address)).to.be.revertedWith(
      CALLER_NOT_POOL_ADMIN
    );
  });
  it('GaugeFactory revoke operator success', async () => {
    const { gaugeFactory } = testEnv;
    await gaugeFactory.addOperator(alice.address);
    expect(await gaugeFactory.isOperator(alice.address)).to.be.true;
    await gaugeFactory.removeOperator(alice.address);
    expect(await gaugeFactory.isOperator(alice.address)).to.be.false;
  });
  it('GaugeFactory create lending gauge will revert because underlying asset address is zero', async () => {
    const { gaugeFactory } = testEnv;
    await expect(gaugeFactory.createLendingGauge(ZERO_ADDRESS)).to.be.revertedWith(
      PARAMETER_ADDRESS_NOT_ZERO
    );
  });
  it('GaugeFactory create lending gauge will revert because caller is not operator', async () => {
    const { gaugeFactory, usdc } = testEnv;
    await expect(gaugeFactory.connect(alice.signer).createLendingGauge(usdc.address)).to.be
      .reverted;
  });
  it('GaugeFactory create lending gauge success', async () => {
    const { gaugeFactory, usdc } = testEnv;
    expect(await gaugeFactory.allLendingGaugesLength()).to.be.equal(1);
    expect(await gaugeFactory.lendingGauge(usdc.address)).to.be.equal(ZERO_ADDRESS);
    await expect(gaugeFactory.createLendingGauge(usdc.address))
      .to.be.emit(gaugeFactory, 'LendingGaugeCreated')
      .withArgs(usdc.address, '0xb32D47DA94d7D45A7c47953aE48dA2fb12f8d3c6', 2);
    expect(await gaugeFactory.lendingGauge(usdc.address)).to.be.equal(
      '0xb32D47DA94d7D45A7c47953aE48dA2fb12f8d3c6'
    );
  });
  it('GaugeFactory set lending gauge impl will revert because lending gauge impl address is zero', async () => {
    const { gaugeFactory } = testEnv;
    await expect(gaugeFactory.setLendingGaugeImplementation(ZERO_ADDRESS)).to.be.revertedWith(
      PARAMETER_ADDRESS_NOT_ZERO
    );
  });
  it('GaugeFactory set lending gauge impl will revert because lending gauge impl is not pool admin', async () => {
    const { gaugeFactory } = testEnv;
    await expect(
      gaugeFactory.connect(bob.signer).setLendingGaugeImplementation(alice.address)
    ).to.be.revertedWith(CALLER_NOT_POOL_ADMIN);
  });
  it('GaugeFactory set lending gauge impl success', async () => {
    const { gaugeFactory, lendingGauge } = testEnv;
    await expect(gaugeFactory.setLendingGaugeImplementation(lendingGauge.address))
      .to.be.emit(gaugeFactory, 'SetLendingGaugeImplementation')
      .withArgs(lendingGauge.address);
  });
});
