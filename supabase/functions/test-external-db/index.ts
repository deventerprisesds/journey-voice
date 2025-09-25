import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Client } from "https://deno.land/x/postgres@v0.17.0/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TestResult {
  test: string;
  status: 'PASS' | 'FAIL';
  message: string;
  data?: any;
  error?: string;
}

interface TestReport {
  overall_status: 'PASS' | 'FAIL';
  timestamp: string;
  tests: TestResult[];
  summary: string;
}

serve(async (req) => {
  console.log('Test External DB function called');
  
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const results: TestResult[] = [];
  let client: Client | null = null;

  try {
    const externalDbUrl = Deno.env.get('EXTERNAL_DATABASE_URL');
    
    if (!externalDbUrl) {
      results.push({
        test: 'Environment Check',
        status: 'FAIL',
        message: 'EXTERNAL_DATABASE_URL environment variable not found',
        error: 'Missing environment variable'
      });
    } else {
      results.push({
        test: 'Environment Check',
        status: 'PASS',
        message: 'EXTERNAL_DATABASE_URL is configured'
      });
    }

    // Test 1: Database Connection
    console.log('Testing database connection...');
    try {
      client = new Client(externalDbUrl!);
      await client.connect();
      
      const versionResult = await client.queryObject('SELECT version(), now() as current_time');
      results.push({
        test: 'Database Connection',
        status: 'PASS',
        message: 'Successfully connected to external database',
        data: {
          version: (versionResult.rows[0] as any)?.version,
          server_time: (versionResult.rows[0] as any)?.current_time
        }
      });
      console.log('Database connection successful');
    } catch (error) {
      results.push({
        test: 'Database Connection',
        status: 'FAIL',
        message: 'Failed to connect to external database',
        error: (error as Error).message
      });
      console.error('Database connection failed:', error);
    }

    if (client) {
      // Test 2: Schema Validation
      console.log('Testing schema validation...');
      try {
        const schemaResult = await client.queryObject(`
          SELECT column_name, data_type, is_nullable 
          FROM information_schema.columns 
          WHERE table_name = 'chat_messages2' 
          ORDER BY ordinal_position
        `);
        
        const expectedColumns = ['id', 'role', 'content', 'created_at', 'metadata', 'user_input'];
        const actualColumns = schemaResult.rows.map((row: any) => (row as any).column_name);
        const missingColumns = expectedColumns.filter(col => !actualColumns.includes(col));
        
        if (missingColumns.length === 0) {
          results.push({
            test: 'Schema Validation',
            status: 'PASS',
            message: 'All expected columns found in chat_messages2 table',
            data: { columns: schemaResult.rows }
          });
        } else {
          results.push({
            test: 'Schema Validation',
            status: 'FAIL',
            message: `Missing columns: ${missingColumns.join(', ')}`,
            data: { 
              expected: expectedColumns,
              actual: actualColumns,
              missing: missingColumns
            }
          });
        }
        console.log('Schema validation completed');
      } catch (error) {
        results.push({
          test: 'Schema Validation',
          status: 'FAIL',
          message: 'Failed to validate schema - table may not exist',
          error: (error as Error).message
        });
        console.error('Schema validation failed:', error);
      }

      // Test 3: Data Access Test
      console.log('Testing data access...');
      try {
        const countResult = await client.queryObject('SELECT COUNT(*) as total_rows FROM chat_messages2');
        const recentResult = await client.queryObject(`
          SELECT role, content, created_at 
          FROM chat_messages2 
          ORDER BY created_at DESC 
          LIMIT 3
        `);
        
        results.push({
          test: 'Data Access',
          status: 'PASS',
          message: 'Successfully accessed chat_messages2 data',
          data: {
            total_rows: (countResult.rows[0] as any)?.total_rows,
            recent_messages: recentResult.rows
          }
        });
        console.log('Data access test successful');
      } catch (error) {
        results.push({
          test: 'Data Access',
          status: 'FAIL',
          message: 'Failed to access chat_messages2 data',
          error: (error as Error).message
        });
        console.error('Data access failed:', error);
      }

      // Test 4: September 19th Search Test
      console.log('Testing September 19th search...');
      try {
        const sept19Result = await client.queryObject(`
          SELECT role, content, created_at 
          FROM chat_messages2 
          WHERE created_at >= '2024-09-19 00:00:00' 
            AND created_at < '2024-09-20 00:00:00'
          ORDER BY created_at DESC
        `);
        
        results.push({
          test: 'September 19th Search',
          status: 'PASS',
          message: `Found ${sept19Result.rows.length} messages from September 19th, 2024`,
          data: {
            message_count: sept19Result.rows.length,
            messages: sept19Result.rows
          }
        });
        console.log(`September 19th search found ${sept19Result.rows.length} messages`);
      } catch (error) {
        results.push({
          test: 'September 19th Search',
          status: 'FAIL',
          message: 'Failed to search for September 19th messages',
          error: (error as Error).message
        });
        console.error('September 19th search failed:', error);
      }

      // Test 5: Task Keywords Search Test
      console.log('Testing task keywords search...');
      try {
        const taskKeywords = [
          'task', 'todo', 'assignment', 'project', 'deadline', 'due', 'complete', 'finish',
          'work', 'job', 'responsibility', 'action item', 'reminder', 'schedule', 'plan',
          'goal', 'objective', 'milestone', 'deliverable', 'priority'
        ];
        
        const keywordConditions = taskKeywords.map(keyword => 
          `LOWER(content) LIKE '%${keyword.toLowerCase()}%'`
        ).join(' OR ');
        
        const taskSearchResult = await client.queryObject(`
          SELECT role, content, created_at 
          FROM chat_messages2 
          WHERE (${keywordConditions})
          ORDER BY created_at DESC 
          LIMIT 5
        `);
        
        results.push({
          test: 'Task Keywords Search',
          status: 'PASS',
          message: `Found ${taskSearchResult.rows.length} task-related messages`,
          data: {
            message_count: taskSearchResult.rows.length,
            sample_messages: taskSearchResult.rows
          }
        });
        console.log(`Task keywords search found ${taskSearchResult.rows.length} messages`);
      } catch (error) {
        results.push({
          test: 'Task Keywords Search',
          status: 'FAIL',
          message: 'Failed to search for task-related messages',
          error: (error as Error).message
        });
        console.error('Task keywords search failed:', error);
      }
    }

  } catch (error) {
    results.push({
      test: 'General Error',
      status: 'FAIL',
      message: 'Unexpected error during testing',
      error: (error as Error).message
    });
    console.error('General error:', error);
  } finally {
    if (client) {
      try {
        await client.end();
        console.log('Database connection closed');
      } catch (error) {
        console.error('Error closing database connection:', error);
      }
    }
  }

  // Generate report
  const passedTests = results.filter(r => r.status === 'PASS').length;
  const totalTests = results.length;
  const overallStatus = passedTests === totalTests ? 'PASS' : 'FAIL';
  
  const report: TestReport = {
    overall_status: overallStatus,
    timestamp: new Date().toISOString(),
    tests: results,
    summary: `${passedTests}/${totalTests} tests passed. ${overallStatus === 'PASS' ? 'All systems operational!' : 'Issues detected - check individual test results.'}`
  };

  console.log(`Test completed: ${report.summary}`);

  return new Response(JSON.stringify(report, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});