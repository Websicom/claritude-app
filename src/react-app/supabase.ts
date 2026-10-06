import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || "https://dfaxmxschvzmlozxjaxf.supabase.co",
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_zNc8TQjoFQ-OI2nKbiNOPA_5ukCoCY6",
);
