// === Supabase Client (conexão com banco) ===
// substitua SUPABASE_URL e SUPABASE_PUBLIC_KEY pelas suas chaves

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://pyaswwtpydpngtfmxmur.supabase.co"; // ex: https://abcd1234.supabase.co
const SUPABASE_PUBLIC_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5YXN3d3RweWRwbmd0Zm14bXVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMTQxOTksImV4cCI6MjA3Nzc5MDE5OX0.NuZqJRRhM1ktbOrPhnxQHC0knaEBYFnQeXiVrdyTiBA";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
