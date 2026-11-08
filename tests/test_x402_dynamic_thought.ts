import { X402PaymentEngine } from '../src/x402/middleware';

async function testX402DynamicAndThoughtStream() {
  console.log('====================================================');
  console.log('🚀 启动 x402 动态定价与链上思考流 (Thought Hash) 自动化验证');
  console.log('====================================================');

  const engine = new X402PaymentEngine('11111111111111111111111111111111');

  // 1. 创建带有动态定价档位和链上思考流哈希的账单
  const thoughtHash = '0xabc123thoughtstreamhash890def';
  const invoice = engine.createInvoice(0.005, 0.25, 120, {
    thoughtHash,
    tier: 'PREMIUM_ALPHA_SNIPER',
  });

  console.log('🧾 动态支付账单创建成功:');
  console.log(`  - Nonce: ${invoice.paymentNonce}`);
  console.log(`  - 金额: ${invoice.amountSol} SOL (${invoice.amountUsdc} USDC)`);
  console.log(`  - 档位: ${invoice.tier}`);
  console.log(`  - 思考流哈希 (Thought Hash): ${invoice.thoughtHash}`);

  // 2. 模拟支付并核验
  const fakeTxSig = '5Kz8...fakeSolanaTxSignatureWithThoughtHash';
  const verifyResult = engine.verifyPayment(invoice.paymentNonce, fakeTxSig, 0.005);
  
  if (!verifyResult.valid) {
    throw new Error(`❌ 支付验证失败: ${verifyResult.error}`);
  }
  console.log('✅ x402 支付验证通过！');

  // 3. 获取结算回执并验证 Thought Hash 审计闭环
  const receipt = engine.getSettlementReceipt(fakeTxSig);
  if (receipt && receipt.thoughtHash === thoughtHash) {
    console.log('✅ [支付即证明闭环成功] 结算回执成功捕获 Thought Hash:');
    console.log(`  - 交易签名: ${receipt.txSignature}`);
    console.log(`  - 付款人: ${receipt.payer}`);
    console.log(`  - 关联思考流哈希: ${receipt.thoughtHash}`);
    console.log(`  - 结算金额: ${receipt.amountSol} SOL`);
  } else {
    throw new Error('❌ 结算回执中未正确关联 Thought Hash');
  }

  console.log('====================================================');
  console.log('🎉 x402 动态定价与链上思考流自动化验证全部顺利通过！');
  console.log('====================================================');
}

testX402DynamicAndThoughtStream().catch((err) => {
  console.error('❌ 测试运行异常:', err);
  process.exit(1);
});
