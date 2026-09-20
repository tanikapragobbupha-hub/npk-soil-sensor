// ============================================
// src/lib/supabase.js
// ============================================

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "ไม่พบ VITE_SUPABASE_URL หรือ VITE_SUPABASE_ANON_KEY — เช็คว่าสร้างไฟล์ .env แล้วหรือยัง"
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function getLatestSoilReading(deviceId = "NPK-001") {
  const { data, error } = await supabase
    .from("soil_readings")
    .select("*")
    .eq("device_id", deviceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
