-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- USERS (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  full_name text,
  phone text,
  email text,
  is_admin boolean DEFAULT false,
  notes text
);

-- VEHICLES
CREATE TABLE public.vehicles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  year text,
  make text,
  model text,
  color text,
  type text CHECK (type IN ('sedan', 'suv', 'truck')),
  notes text
);

-- SERVICES catalog
CREATE TABLE public.services (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  description text,
  price_sedan integer, -- cents
  price_suv integer,   -- cents
  duration_minutes integer,
  active boolean DEFAULT true,
  sort_order integer DEFAULT 0
);

-- AVAILABILITY (your working schedule)
CREATE TABLE public.availability (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
  start_time time,
  end_time time,
  max_bookings integer DEFAULT 3,
  active boolean DEFAULT true
);

-- BLOCKED DATES
CREATE TABLE public.blocked_dates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  date date NOT NULL,
  reason text
);

-- BOOKINGS
CREATE TABLE public.bookings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  user_id uuid REFERENCES public.profiles(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  service_id uuid REFERENCES public.services(id),
  service_name text,
  vehicle_type text,
  preferred_date date,
  preferred_time time,
  addons jsonb DEFAULT '[]',
  notes text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
  deposit_paid boolean DEFAULT false,
  deposit_amount integer DEFAULT 5000,
  total_amount integer,
  square_payment_id text,
  admin_notes text
);

-- MEMBERSHIPS
CREATE TABLE public.memberships (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  user_id uuid REFERENCES public.profiles(id) UNIQUE,
  plan text CHECK (plan IN ('sedan', 'suv')),
  status text DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  price_cents integer,
  square_subscription_id text,
  next_billing_date date,
  cancelled_at timestamptz
);

-- PAYMENTS
CREATE TABLE public.payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  user_id uuid REFERENCES public.profiles(id),
  booking_id uuid REFERENCES public.bookings(id),
  amount integer, -- cents
  type text CHECK (type IN ('deposit', 'balance', 'membership')),
  square_payment_id text,
  status text DEFAULT 'completed'
);

-- RLS POLICIES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_dates ENABLE ROW LEVEL SECURITY;

-- Profiles: users see own, admin sees all
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admin can view all profiles" ON public.profiles FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Vehicles: users manage own
CREATE POLICY "Users manage own vehicles" ON public.vehicles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admin can view all vehicles" ON public.vehicles FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Bookings: users see own
CREATE POLICY "Users manage own bookings" ON public.bookings FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admin manages all bookings" ON public.bookings FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Memberships: users see own
CREATE POLICY "Users manage own membership" ON public.memberships FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admin manages all memberships" ON public.memberships FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Payments: users see own
CREATE POLICY "Users view own payments" ON public.payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admin manages all payments" ON public.payments FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Services/Availability/Blocked: public read
CREATE POLICY "Anyone can read services" ON public.services FOR SELECT USING (true);
CREATE POLICY "Anyone can read availability" ON public.availability FOR SELECT USING (true);
CREATE POLICY "Anyone can read blocked dates" ON public.blocked_dates FOR SELECT USING (true);
CREATE POLICY "Admin manages services" ON public.services FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admin manages availability" ON public.availability FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);
CREATE POLICY "Admin manages blocked dates" ON public.blocked_dates FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Seed services
INSERT INTO public.services (name, slug, price_sedan, price_suv, duration_minutes, sort_order) VALUES
  ('The Refresh', 'refresh', 14900, 17900, 90, 1),
  ('The Signature', 'signature', 24900, 29900, 180, 2),
  ('The Diamond', 'diamond', 39900, 44900, 360, 3),
  ('Paint Correction', 'paint-correction', 44900, 54900, 360, 4),
  ('Ceramic Coating', 'ceramic', 79900, 99900, 480, 5),
  ('The Ultimate', 'ultimate', 119900, 149900, 600, 6);

-- Seed default availability (Mon-Sat 8am-5pm, max 3/day)
INSERT INTO public.availability (day_of_week, start_time, end_time, max_bookings) VALUES
  (1, '08:00', '17:00', 3),
  (2, '08:00', '17:00', 3),
  (3, '08:00', '17:00', 3),
  (4, '08:00', '17:00', 3),
  (5, '08:00', '17:00', 3),
  (6, '08:00', '17:00', 3);
