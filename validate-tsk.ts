import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// Verify env vars are loaded before importing problematic modules
if (!process.env.KV_REST_API_URL || !process.env.POSTGRES_URL) {
  console.error('Environment variables not loaded! Check .env.local');
  process.exit(1);
}

// Now import after env is guaranteed
import { retrieveContextForQuery } from './lib/retrieval';

async function testTsk() {
  console.log('--- TSK Retrieval Validation ---');
  // John 1:1 is also high-signal
  console.log('Querying: "John 1:1"');
  
  try {
    const verses = await retrieveContextForQuery('John 1:1', 'BSB');
    
    const primary = verses.filter(v => !v.isCrossReference);
    const supporting = verses.filter(v => v.isCrossReference);
    
    console.log(`\nPrimary Verses Found: ${primary.length}`);
    primary.forEach(v => console.log(` - ${v.reference}`));
    
    console.log(`\nSupporting Cross-References (TSK) Found: ${supporting.length}`);
    supporting.forEach(v => {
        console.log(` - ${v.reference} (Text beginning: ${v.text.substring(0, 50)}...)`);
    });
    
    if (supporting.length > 0) {
      console.log('\n✅ SUCCESS: TSK Cross-references successfully retrieved and typed.');
    } else {
      console.log('\n❌ FAILURE: No TSK cross-references found for a high-signal verse like John 3:16.');
    }
  } catch (err) {
    console.error('\n💥 ERROR during retrieval:', err);
  }
}

testTsk();
