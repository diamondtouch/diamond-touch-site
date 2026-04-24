-- Diamond Touch Detailing — invoices table
-- Run this in Supabase SQL Editor or via: supabase db push

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  short_code text UNIQUE NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  tip_cents integer NOT NULL DEFAULT 0,
  total_paid_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'viewed', 'paid')),
  sent_to_email text,
  square_payment_id text,
  paid_at timestamptz
);

-- RLS
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Admin can do everything
CREATE POLICY "Admin manages all invoices" ON public.invoices FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Users can view their own invoices
CREATE POLICY "Users view own invoices" ON public.invoices FOR SELECT USING (
  auth.uid() = user_id
);

-- Service role (edge functions) bypasses RLS automatically
