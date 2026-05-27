import { createGeminiClient } from '../src/agent/gemini-report-generator.js';

const gemini = createGeminiClient({ projectId: 'ebeecontrol' });

console.log('Testing Gemini connection...');
gemini('Analyze this security incident: An attacker process /tmp/.hidden/reverse-shell (PID 31337, root) read the honeytoken at /var/run/secrets/kubernetes.io/serviceaccount/decoy-token in pod pod-payment-7f8d9c in the production namespace. The Davis AI anomaly score was 0.85. What is the likely attacker intent and what follow-up actions should the security team take?')
  .then((response) => {
    console.log('✅ Gemini responded:\n');
    console.log(response);
  })
  .catch((error) => {
    console.error('❌ Gemini failed:', error.message);
    console.error('\nMake sure you have:');
    console.error('  1. gcloud auth application-default login');
    console.error('  2. export GOOGLE_CLOUD_PROJECT=ebeecontrol');
    console.error('  3. gcloud services enable aiplatform.googleapis.com');
  });
