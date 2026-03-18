-- Add INSERT policies for kierowca role on zlecenia and zlecenia_wz (for domówienie)
CREATE POLICY "kierowca_insert_zlecenia"
ON public.zlecenia
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'kierowca'::app_role)
  AND status = 'do_weryfikacji'
);

CREATE POLICY "kierowca_insert_zlecenia_wz"
ON public.zlecenia_wz
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'kierowca'::app_role)
);