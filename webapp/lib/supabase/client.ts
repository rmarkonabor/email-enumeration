import { createBrowserClient } from "@supabase/ssr";

const SUPABASE_URL = "https://joquyqffkzpageynolcw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpvcXV5cWZma3pwYWdleW5vbGN3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4NjEyNTQsImV4cCI6MjA5NDQzNzI1NH0.H8HsjmThqCE5jQSmo1Qih1nmhdP2o6b5pVb1mXvdWyI";

export function createClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
