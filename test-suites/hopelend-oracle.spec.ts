import { MOCK_CHAINLINK_AGGREGATORS_PRICES } from 'lend-deploy/dist/helpers/constants';
import { expect } from 'chai';
import { oneEther, ONE_ADDRESS, ZERO_ADDRESS } from '../helpers/constants';
import { ProtocolErrors } from '../helpers/types';
import { makeSuite, TestEnv } from './helpers/make-suite';
import {
  deployMintableERC20,
  deployMockAggregator,
  evmRevert,
  evmSnapshot,
  MintableERC20,
  MockAggregator,
} from 'lend-deploy';

makeSuite('HopeLendOracle', (testEnv: TestEnv) => {
  let snap: string;

  beforeEach(async () => {
    snap = await evmSnapshot();
  });
  afterEach(async () => {
    await evmRevert(snap);
  });

  let mockToken: MintableERC20;
  let mockAggregator: MockAggregator;
  let assetPrice: string;

  before(async () => {
    mockToken = await deployMintableERC20(['MOCK', 'MOCK', '18']);
    assetPrice = MOCK_CHAINLINK_AGGREGATORS_PRICES.ETH;
    mockAggregator = await deployMockAggregator(assetPrice);
  });

  it('Owner set a new asset source', async () => {
    const { poolAdmin, hopeLendOracle } = testEnv;

    // Asset has no source
    expect(await hopeLendOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);
    const priorSourcePrice = await hopeLendOracle.getAssetPrice(mockToken.address);
    const priorSourcesPrices = (await hopeLendOracle.getAssetsPrices([mockToken.address])).map((x) =>
      x.toString()
    );
    expect(priorSourcePrice).to.equal('0');
    expect(priorSourcesPrices).to.eql(['0']);

    // Add asset source
    expect(
      await hopeLendOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [mockAggregator.address])
    )
      .to.emit(hopeLendOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, mockAggregator.address);

    const sourcesPrices = await (
      await hopeLendOracle.getAssetsPrices([mockToken.address])
    ).map((x) => x.toString());
    expect(await hopeLendOracle.getSourceOfAsset(mockToken.address)).to.be.eq(mockAggregator.address);
    expect(await hopeLendOracle.getAssetPrice(mockToken.address)).to.be.eq(assetPrice);
    expect(sourcesPrices).to.eql([assetPrice]);
  });

  it('Owner update an existing asset source', async () => {
    const { poolAdmin, hopeLendOracle, dai } = testEnv;

    // DAI token has already a source
    const daiSource = await hopeLendOracle.getSourceOfAsset(dai.address);
    expect(daiSource).to.be.not.eq(ZERO_ADDRESS);

    // Update DAI source
    expect(
      await hopeLendOracle
        .connect(poolAdmin.signer)
        .setAssetSources([dai.address], [mockAggregator.address])
    )
      .to.emit(hopeLendOracle, 'AssetSourceUpdated')
      .withArgs(dai.address, mockAggregator.address);

    expect(await hopeLendOracle.getSourceOfAsset(dai.address)).to.be.eq(mockAggregator.address);
    expect(await hopeLendOracle.getAssetPrice(dai.address)).to.be.eq(assetPrice);
  });

  it('Owner tries to set a new asset source with wrong input params (revert expected)', async () => {
    const { poolAdmin, hopeLendOracle } = testEnv;

    await expect(
      hopeLendOracle.connect(poolAdmin.signer).setAssetSources([mockToken.address], [])
    ).to.be.revertedWith(ProtocolErrors.INCONSISTENT_PARAMS_LENGTH);
  });

  it('Get price of BASE_CURRENCY asset', async () => {
    const { hopeLendOracle } = testEnv;

    // Check returns the fixed price BASE_CURRENCY_UNIT
    expect(await hopeLendOracle.getAssetPrice(await hopeLendOracle.BASE_CURRENCY())).to.be.eq(
      await hopeLendOracle.BASE_CURRENCY_UNIT()
    );
  });

  it('A non-owner user tries to set a new asset source (revert expected)', async () => {
    const { users, hopeLendOracle } = testEnv;
    const user = users[0];

    const { CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN } = ProtocolErrors;

    await expect(
      hopeLendOracle.connect(user.signer).setAssetSources([mockToken.address], [mockAggregator.address])
    ).to.be.revertedWith(CALLER_NOT_ASSET_LISTING_OR_POOL_ADMIN);
  });

  it('Get price of BASE_CURRENCY asset with registered asset source for its address', async () => {
    const { poolAdmin, hopeLendOracle, weth } = testEnv;

    // Add asset source for BASE_CURRENCY address
    expect(
      await hopeLendOracle
        .connect(poolAdmin.signer)
        .setAssetSources([weth.address], [mockAggregator.address])
    )
      .to.emit(hopeLendOracle, 'AssetSourceUpdated')
      .withArgs(weth.address, mockAggregator.address);

    // Check returns the fixed price BASE_CURRENCY_UNIT
    expect(await hopeLendOracle.getAssetPrice(weth.address)).to.be.eq(
      MOCK_CHAINLINK_AGGREGATORS_PRICES.WETH
    );
  });

  it('Get price of asset with no asset source', async () => {
    const { hopeLendOracle, oracle } = testEnv;
    const fallbackPrice = oneEther;

    // Register price on FallbackOracle
    expect(await oracle.setAssetPrice(mockToken.address, fallbackPrice));

    // Asset has no source
    expect(await hopeLendOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Returns 0 price
    expect(await hopeLendOracle.getAssetPrice(mockToken.address)).to.be.eq(fallbackPrice);
  });

  it('Get price of asset with 0 price and no fallback price', async () => {
    const { poolAdmin, hopeLendOracle } = testEnv;
    const zeroPriceMockAgg = await deployMockAggregator('0');

    // Asset has no source
    expect(await hopeLendOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Add asset source
    expect(
      await hopeLendOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [zeroPriceMockAgg.address])
    )
      .to.emit(hopeLendOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, zeroPriceMockAgg.address);

    expect(await hopeLendOracle.getSourceOfAsset(mockToken.address)).to.be.eq(zeroPriceMockAgg.address);
    expect(await hopeLendOracle.getAssetPrice(mockToken.address)).to.be.eq(0);
  });

  it('Get price of asset with 0 price but non-zero fallback price', async () => {
    const { poolAdmin, hopeLendOracle, oracle } = testEnv;
    const zeroPriceMockAgg = await deployMockAggregator('0');
    const fallbackPrice = oneEther;

    // Register price on FallbackOracle
    expect(await oracle.setAssetPrice(mockToken.address, fallbackPrice));

    // Asset has no source
    expect(await hopeLendOracle.getSourceOfAsset(mockToken.address)).to.be.eq(ZERO_ADDRESS);

    // Add asset source
    expect(
      await hopeLendOracle
        .connect(poolAdmin.signer)
        .setAssetSources([mockToken.address], [zeroPriceMockAgg.address])
    )
      .to.emit(hopeLendOracle, 'AssetSourceUpdated')
      .withArgs(mockToken.address, zeroPriceMockAgg.address);

    expect(await hopeLendOracle.getSourceOfAsset(mockToken.address)).to.be.eq(zeroPriceMockAgg.address);
    expect(await hopeLendOracle.getAssetPrice(mockToken.address)).to.be.eq(fallbackPrice);
  });

  it('Owner update the FallbackOracle', async () => {
    const { poolAdmin, hopeLendOracle, oracle } = testEnv;

    expect(await hopeLendOracle.getFallbackOracle()).to.be.eq(oracle.address);

    // Update oracle source
    expect(await hopeLendOracle.connect(poolAdmin.signer).setFallbackOracle(ONE_ADDRESS))
      .to.emit(hopeLendOracle, 'FallbackOracleUpdated')
      .withArgs(ONE_ADDRESS);

    expect(await hopeLendOracle.getFallbackOracle()).to.be.eq(ONE_ADDRESS);
  });
});
