/**
 * اختبار بسيط للوحدات بدون قاعدة البيانات
 */

const SecurityManager = require('./api/telegram/utils/security-test');
const FlowManager = require('./api/telegram/utils/flowManager');
const ErrorHandler = require('./api/telegram/utils/errorHandler');

console.log('🧪 Testing modules without database...\n');

// Test SecurityManager
console.log('🔐 Testing SecurityManager...');
const testInput = '<script>alert("xss")</script>Hello World!';
const sanitized = SecurityManager.sanitizeInput(testInput, 50);
console.log('✅ sanitizeInput:', { input: testInput, output: sanitized });

const validEmail = SecurityManager.validateEmail('test@example.com');
const invalidEmail = SecurityManager.validateEmail('invalid-email');
console.log('✅ validateEmail:', { valid: validEmail, invalid: invalidEmail });

// Test FlowManager
console.log('\n🔄 Testing FlowManager...');
const userId = '123456789';
FlowManager.setFlow(userId, 'test_flow', 1, { testData: 'value' });
console.log('✅ setFlow: Flow created');

const flow = FlowManager.getFlow(userId);
console.log('✅ getFlow:', flow);

const hasActive = FlowManager.hasActiveFlow(userId, 'test_flow');
console.log('✅ hasActiveFlow:', hasActive);

FlowManager.updateStep(userId, 2);
const updatedFlow = FlowManager.getFlow(userId);
console.log('✅ updateStep:', updatedFlow.step);

const stats = FlowManager.getFlowStats();
console.log('✅ getFlowStats:', stats);

// Test ErrorHandler
console.log('\n🚨 Testing ErrorHandler...');
const mockCtx = {
  from: { id: 123456789, username: 'testuser' },
  chat: { id: 123456789 },
  reply: async (msg) => console.log('📱 Mock Reply:', msg)
};

const testError = new Error('Rate limit exceeded');
const errorType = ErrorHandler.getErrorType(testError);
console.log('✅ getErrorType:', errorType);

// Test safeExecute
const successOperation = async () => 'Success!';
ErrorHandler.safeExecute(successOperation, mockCtx, 'test_operation').then(result => {
  console.log('✅ safeExecute success:', result);
});

console.log('\n🎉 Module tests completed!');