insert into public.categories (name, slug, icon, description, sort_order)
values
  ('Plumbing', 'plumbing', 'wrench', 'Repairs, installation, leaks, and maintenance.', 10),
  ('Electrical', 'electrical', 'zap', 'Wiring, fittings, generator, and power troubleshooting.', 20),
  ('Cleaning', 'cleaning', 'sparkles', 'Home, office, post-construction, and deep cleaning.', 30),
  ('Carpentry', 'carpentry', 'hammer', 'Furniture, fittings, woodwork, and repairs.', 40),
  ('Painting', 'painting', 'paintbrush', 'Interior, exterior, residential, and commercial painting.', 50),
  ('Web Development', 'web-development', 'code', 'Websites, dashboards, ecommerce, and web apps.', 60),
  ('Graphic Design', 'graphic-design', 'palette', 'Branding, flyers, social designs, and digital assets.', 70),
  ('Photography', 'photography', 'camera', 'Events, product shoots, portraits, and editing.', 80),
  ('Catering', 'catering', 'utensils', 'Food service for homes, offices, and events.', 90),
  ('Tutoring', 'tutoring', 'book-open', 'Academic, exam prep, professional, and skills tutoring.', 100)
on conflict (slug) do update
set name = excluded.name,
    icon = excluded.icon,
    description = excluded.description,
    sort_order = excluded.sort_order,
    is_active = true;
