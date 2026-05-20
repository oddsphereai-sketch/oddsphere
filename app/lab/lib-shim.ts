// Thin re-export so the lab/page connection check can `await import()` the
// supabase client without reaching outside its own subtree. Keeps the
// dynamic-import boundary local to the /lab feature.

export { supabase } from "../lib/supabase";
