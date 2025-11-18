const url = 'https://pyaswwtpydpngtfmxmur.supabase.co/auth/v1/token?grant_type=password';
const apikey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5YXN3d3RweWRwbmd0Zm14bXVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIyMTQxOTksImV4cCI6MjA3Nzc5MDE5OX0.NuZqJRRhM1ktbOrPhnxQHC0knaEBYFnQeXiVrdyTiBA';
const body = { email: 'test@example.com', password: 'wrongpass' };
const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey }, body: JSON.stringify(body) });
console.log('status', res.status);
const text = await res.text();
console.log(text);

