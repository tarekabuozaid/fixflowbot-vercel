/**
 * Test file for new modular utilities
 * This file demonstrates how to use the new modules
 */

const SecurityManager = require('../api/telegram/utils/security');
const FlowManager = require('../api/telegram/utils/flowManager');
const PlanManager = require('../api/telegram/utils/planManager');
const ErrorHandler = require('../api/telegram/utils/errorHandler');

// Mock Telegram context for testing
const mockCtx = {
  from: {
    id: 123456789,
    first_name: 'Test',
    last_name: 'User',
    username: 'testuser'
  },
  chat: {
    id: 123456789
  },
  reply: async (message) => {
    console.log('📱 Bot Reply:', message);
    return { message_id: 1 };
  },
  answerCbQuery: async () => {
    console.log('✅ Callback Query Answered');
  }
};

/**
 * Test Security Manager
 */
async function testSecurityManager() {
  console.log('\n🔐 Testing Security Manager...');
  
  try {
    // Test sanitizeInput
    const testInput = '<script>alert("xss")</script>Hello World!';
    const sanitized = SecurityManager.sanitizeInput(testInput, 50);
    console.log('✅ sanitizeInput:', { input: testInput, output: sanitized });
    
    // Test validateEmail
    const validEmail = SecurityManager.validateEmail('test@example.com');
    const invalidEmail = SecurityManager.validateEmail('invalid-email');
    console.log('✅ validateEmail:', { valid: validEmail, invalid: invalidEmail });
    
    // Test validatePhone
    const validPhone = SecurityManager.validatePhone('+1234567890');
    const invalidPhone = SecurityManager.validatePhone('123');
    console.log('✅ validatePhone:', { valid: validPhone, invalid: invalidPhone });
    
    // Test validateName
    const validName = SecurityManager.validateName('John Doe');
    const invalidName = SecurityManager.validateName('A');
    console.log('✅ validateName:', { valid: validName, invalid: invalidName });
    
  } catch (error) {
    console.error('❌ Security Manager Test Failed:', error);
  }
}

/**
 * Test Flow Manager
 */
async function testFlowManager() {
  console.log('\n🔄 Testing Flow Manager...');
  
  try {
    const userId = '123456789';
    
    // Test setFlow
    FlowManager.setFlow(userId, 'test_flow', 1, { testData: 'value' });
    console.log('✅ setFlow: Flow created');
    
    // Test getFlow
    const flow = FlowManager.getFlow(userId);
    console.log('✅ getFlow:', flow);
    
    // Test hasActiveFlow
    const hasActive = FlowManager.hasActiveFlow(userId, 'test_flow');
    console.log('✅ hasActiveFlow:', hasActive);
    
    // Test updateStep
    FlowManager.updateStep(userId, 2);
    const updatedFlow = FlowManager.getFlow(userId);
    console.log('✅ updateStep:', updatedFlow.step);
    
    // Test updateData
    FlowManager.updateData(userId, { newData: 'newValue' });
    const dataUpdatedFlow = FlowManager.getFlow(userId);
    console.log('✅ updateData:', dataUpdatedFlow.data);
    
    // Test validateFlowOwnership
    const isValid = FlowManager.validateFlowOwnership(userId, flow);
    console.log('✅ validateFlowOwnership:', isValid);
    
    // Test getFlowStats
    const stats = FlowManager.getFlowStats();
    console.log('✅ getFlowStats:', stats);
    
    // Test clearFlow
    FlowManager.clearFlow(userId);
    const clearedFlow = FlowManager.getFlow(userId);
    console.log('✅ clearFlow:', clearedFlow === null);
    
  } catch (error) {
    console.error('❌ Flow Manager Test Failed:', error);
  }
}

/**
 * Test Plan Manager
 */
async function testPlanManager() {
  console.log('\n📊 Testing Plan Manager...');
  
  try {
    // Test getAvailablePlans
    const plans = PlanManager.getAvailablePlans();
    console.log('✅ getAvailablePlans:', Object.keys(plans));
    
    // Test getPlanComparison
    const comparison = PlanManager.getPlanComparison('Free', 'Pro');
    console.log('✅ getPlanComparison:', {
      current: comparison.current,
      target: comparison.target,
      improvements: comparison.improvements
    });
    
    // Test plan limits structure
    const freePlan = plans.Free;
    console.log('✅ Free Plan Limits:', freePlan);
    
  } catch (error) {
    console.error('❌ Plan Manager Test Failed:', error);
  }
}

/**
 * Test Error Handler
 */
async function testErrorHandler() {
  console.log('\n🚨 Testing Error Handler...');
  
  try {
    // Test getErrorType
    const rateLimitError = new Error('Rate limit exceeded');
    const authError = new Error('Invalid user data');
    const dbError = new Error('Database error');
    dbError.code = 'P2002';
    
    const rateLimitType = ErrorHandler.getErrorType(rateLimitError);
    const authType = ErrorHandler.getErrorType(authError);
    const dbType = ErrorHandler.getErrorType(dbError);
    
    console.log('✅ getErrorType:', {
      rateLimit: rateLimitType,
      auth: authType,
      database: dbType
    });
    
    // Test safeExecute
    const successOperation = async () => 'Success!';
    const failOperation = async () => { throw new Error('Test error'); };
    
    const successResult = await ErrorHandler.safeExecute(successOperation, mockCtx, 'success_test');
    const failResult = await ErrorHandler.safeExecute(failOperation, mockCtx, 'fail_test');
    
    console.log('✅ safeExecute:', {
      success: successResult,
      fail: failResult
    });
    
    // Test error statistics
    const errorStats = ErrorHandler.getErrorStats();
    console.log('✅ getErrorStats:', errorStats);
    
  } catch (error) {
    console.error('❌ Error Handler Test Failed:', error);
  }
}

/**
 * Test integration between modules
 */
async function testIntegration() {
  console.log('\n🔗 Testing Module Integration...');
  
  try {
    const userId = '123456789';
    
    // Simulate a complete flow with all modules
    console.log('📝 Simulating user registration flow...');
    
    // 1. Set up flow
    FlowManager.setFlow(userId, 'register_user', 1, {});
    
    // 2. Validate input
    const userInput = '<script>alert("xss")</script>John Doe';
    const sanitizedInput = SecurityManager.sanitizeInput(userInput, 50);
    const validatedName = SecurityManager.validateName(sanitizedInput);
    
    console.log('✅ Input Processing:', {
      original: userInput,
      sanitized: sanitizedInput,
      validated: validatedName
    });
    
    // 3. Update flow with validated data
    FlowManager.updateData(userId, { fullName: validatedName });
    FlowManager.updateStep(userId, 2);
    
    // 4. Check flow state
    const currentFlow = FlowManager.getFlow(userId);
    console.log('✅ Flow State:', currentFlow);
    
    // 5. Simulate plan check
    const planInfo = PlanManager.getAvailablePlans();
    console.log('✅ Plan Check:', {
      availablePlans: Object.keys(planInfo),
      freePlanLimits: planInfo.Free
    });
    
    // 6. Clean up
    FlowManager.clearFlow(userId);
    console.log('✅ Integration Test Completed Successfully');
    
  } catch (error) {
    console.error('❌ Integration Test Failed:', error);
    await ErrorHandler.handleError(error, mockCtx, 'integration_test');
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  console.log('🧪 Starting Module Tests...\n');
  
  await testSecurityManager();
  await testFlowManager();
  await testPlanManager();
  await testErrorHandler();
  await testIntegration();
  
  console.log('\n🎉 All tests completed!');
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testSecurityManager,
  testFlowManager,
  testPlanManager,
  testErrorHandler,
  testIntegration,
  runAllTests
};
