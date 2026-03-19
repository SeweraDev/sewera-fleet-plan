
-- Fix search_path for all new functions
ALTER FUNCTION oblicz_deadline_wz(DATE) SET search_path = public;
ALTER FUNCTION set_deadline_wz() SET search_path = public;
ALTER FUNCTION update_ma_wz() SET search_path = public;
