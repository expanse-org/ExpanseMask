const EthQuery = require('ethjs-query')
const ethUtil = require('ethereumjs-util')
const BN = ethUtil.BN
const {
  hexToBn,
  BnMultiplyByFraction,
  bnToHex,
} = require('./util')

/*
tx-utils are utility methods for Transaction manager
its passed ethquery
and used to do things like calculate gas of a tx.
*/

module.exports = class txProvideUtil {
  constructor (provider) {
    this.query = new EthQuery(provider)
  }

  async analyzeGasUsage (txMeta) {
    const block = await this.query.getBlockByNumber('latest', true)
    let estimatedGasHex
    try {
      estimatedGasHex = await this.estimateTxGas(txMeta, block.gasLimit)
    } catch (err) {
      const simulationFailed = (
        err.message.includes('Transaction execution error.') ||
        err.message.includes('gas required exceeds allowance or always failing transaction')
      )
      if (simulationFailed) {
        txMeta.simulationFails = true
        return txMeta
      }
    }
    this.setTxGas(txMeta, block.gasLimit, estimatedGasHex)
    return txMeta
  }

  async estimateTxGas (txMeta, blockGasLimitHex) {
    const txParams = txMeta.txParams
    // check if gasLimit is already specified
    txMeta.gasLimitSpecified = Boolean(txParams.gas)
    // if not, fallback to block gasLimit
    if (!txMeta.gasLimitSpecified) {
      const blockGasLimitBN = hexToBn(blockGasLimitHex)
      const saferGasLimitBN = BnMultiplyByFraction(blockGasLimitBN, 19, 20)
      txParams.gas = bnToHex(saferGasLimitBN)
    }
    // run tx
    return await this.query.estimateGas(txParams)
  }

  setTxGas (txMeta, blockGasLimitHex, estimatedGasHex) {
    txMeta.estimatedGas = estimatedGasHex
    const txParams = txMeta.txParams

    // if gasLimit was specified and doesnt OOG,
    // use original specified amount
    if (txMeta.gasLimitSpecified) {
      txMeta.estimatedGas = txParams.gas
      return
    }
    // if gasLimit not originally specified,
    // try adding an additional gas buffer to our estimation for safety
    const recommendedGasHex = this.addGasBuffer(txMeta.estimatedGas, blockGasLimitHex)
    txParams.gas = recommendedGasHex
    return
  }

  addGasBuffer (initialGasLimitHex, blockGasLimitHex) {
    const initialGasLimitBn = hexToBn(initialGasLimitHex)
    const blockGasLimitBn = hexToBn(blockGasLimitHex)
    const upperGasLimitBn = blockGasLimitBn.muln(0.9)
    const bufferedGasLimitBn = new BN(21000)

    // if initialGasLimit is above blockGasLimit, dont modify it
    if (initialGasLimitBn.gt(upperGasLimitBn)) return bnToHex(initialGasLimitBn)
    // if bufferedGasLimit is below blockGasLimit, use bufferedGasLimit
    if (bufferedGasLimitBn.lt(upperGasLimitBn)) return bnToHex(bufferedGasLimitBn)
    // otherwise use blockGasLimit
    return bnToHex(upperGasLimitBn)
  }

  async validateTxParams (txParams) {
    this.validateRecipient(txParams)
    if ('value' in txParams) {
      const value = txParams.value.toString()
      if (value.includes('-')) {
        throw new Error(`Invalid transaction value of ${txParams.value} not a positive number.`)
      }
      if (value.includes('.')) {
        throw new Error(`Invalid transaction value of ${txParams.value} number must be in wei`)
      }
    }
  }

  validateRecipient (txParams) {
    if (txParams.to === '0x' || txParams.to === '') {
      if (txParams.data) {
        delete txParams.to
      } else {
        throw new Error('Invalid recipient address')
      }
    }
    return txParams
  }
}
