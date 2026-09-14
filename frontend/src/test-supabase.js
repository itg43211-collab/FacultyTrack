import { supabase } from './lib/supabase'

console.log('🔵 Testing Supabase...')

async function testSupabase() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .limit(1)

  if (error) {
    console.error('❌ Supabase Error:', error)
  } else {
    console.log('✅ Supabase Connected!')
    console.log('📦 Data:', data)
  }
}

testSupabase()