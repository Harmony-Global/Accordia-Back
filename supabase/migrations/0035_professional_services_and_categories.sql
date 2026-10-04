alter table public.categories
  add column if not exists parent_id uuid references public.categories(id) on delete restrict,
  add column if not exists level text not null default 'legacy',
  add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.categories drop constraint if exists categories_level_check;
alter table public.categories add constraint categories_level_check
  check (level in ('legacy', 'main', 'sub', 'service'));
create index if not exists categories_parent_idx on public.categories(parent_id, sort_order);
create unique index if not exists categories_custom_owner_name_idx
  on public.categories(parent_id, created_by, lower(name)) where level = 'service';

insert into public.categories (slug, name, sort_order)
values
  ('accordia-main-01', 'Technology & Digital Services', 1),
  ('accordia-main-02', 'Creative, Design & Media', 2),
  ('accordia-main-03', 'Marketing, Advertising & Communications', 3),
  ('accordia-main-04', 'Sales & Business Development', 4),
  ('accordia-main-05', 'Business & Management Consulting', 5),
  ('accordia-main-06', 'Finance, Accounting & Insurance', 6),
  ('accordia-main-07', 'Legal, Compliance & Risk', 7),
  ('accordia-main-08', 'Human Resources & Recruitment', 8),
  ('accordia-main-09', 'Engineering & Technical Services', 9),
  ('accordia-main-10', 'Construction & Built Environment', 10),
  ('accordia-main-11', 'Real Estate & Property', 11),
  ('accordia-main-12', 'Manufacturing & Industrial Services', 12),
  ('accordia-main-13', 'Energy, Utilities & Environmental Services', 13),
  ('accordia-main-14', 'Logistics, Transportation & Automotive', 14),
  ('accordia-main-15', 'Retail, E-commerce & Consumer Products', 15),
  ('accordia-main-16', 'Hospitality, Food, Travel & Events', 16),
  ('accordia-main-17', 'Healthcare, Wellness & Personal Care', 17),
  ('accordia-main-18', 'Education, Training & Research', 18),
  ('accordia-main-19', 'Agriculture, Food Production & Natural Resources', 19),
  ('accordia-main-20', 'Safety, Security & Facility Services', 20),
  ('accordia-main-21', 'Home, Lifestyle & Personal Services', 21),
  ('accordia-main-22', 'Government, NGOs & Social Impact', 22),
  ('accordia-main-23', 'Sports, Fitness & Recreation', 23),
  ('accordia-main-24', 'Other & Emerging Industries', 24)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order, level = 'main';
update public.categories set level = 'main' where slug like 'accordia-main-%';

with seed(parent_slug, slug, name, sort_order) as (
  values
  ('accordia-main-01', 'accordia-sub-01-01', 'Software & Web Development', 1),
  ('accordia-main-01', 'accordia-sub-01-02', 'Mobile App Development', 2),
  ('accordia-main-01', 'accordia-sub-01-03', 'UI/UX & Product Design', 3),
  ('accordia-main-01', 'accordia-sub-01-04', 'Data Science & Analytics', 4),
  ('accordia-main-01', 'accordia-sub-01-05', 'Artificial Intelligence & Automation', 5),
  ('accordia-main-01', 'accordia-sub-01-06', 'Cybersecurity', 6),
  ('accordia-main-01', 'accordia-sub-01-07', 'Cloud & IT Infrastructure', 7),
  ('accordia-main-01', 'accordia-sub-01-08', 'IT Support & Managed Services', 8),
  ('accordia-main-01', 'accordia-sub-01-09', 'Blockchain & Web3', 9),
  ('accordia-main-01', 'accordia-sub-01-10', 'Telecommunications', 10),
  ('accordia-main-01', 'accordia-sub-01-11', 'Hardware & Electronics', 11),
  ('accordia-main-01', 'accordia-sub-01-12', 'SaaS & Digital Products', 12),
  ('accordia-main-02', 'accordia-sub-02-01', 'Graphic Design & Branding', 1),
  ('accordia-main-02', 'accordia-sub-02-02', 'Photography', 2),
  ('accordia-main-02', 'accordia-sub-02-03', 'Videography & Film Production', 3),
  ('accordia-main-02', 'accordia-sub-02-04', 'Animation & Motion Graphics', 4),
  ('accordia-main-02', 'accordia-sub-02-05', 'Illustration', 5),
  ('accordia-main-02', 'accordia-sub-02-06', 'Fashion Design', 6),
  ('accordia-main-02', 'accordia-sub-02-07', 'Interior Design', 7),
  ('accordia-main-02', 'accordia-sub-02-08', 'Music & Audio Production', 8),
  ('accordia-main-02', 'accordia-sub-02-09', 'Podcast Production', 9),
  ('accordia-main-02', 'accordia-sub-02-10', 'Content Creation', 10),
  ('accordia-main-02', 'accordia-sub-02-11', 'Publishing', 11),
  ('accordia-main-02', 'accordia-sub-02-12', 'Broadcasting & Media', 12),
  ('accordia-main-03', 'accordia-sub-03-01', 'Digital Marketing', 1),
  ('accordia-main-03', 'accordia-sub-03-02', 'Social Media Management', 2),
  ('accordia-main-03', 'accordia-sub-03-03', 'Advertising', 3),
  ('accordia-main-03', 'accordia-sub-03-04', 'Public Relations', 4),
  ('accordia-main-03', 'accordia-sub-03-05', 'Content Marketing', 5),
  ('accordia-main-03', 'accordia-sub-03-06', 'Copywriting', 6),
  ('accordia-main-03', 'accordia-sub-03-07', 'SEO & Search Marketing', 7),
  ('accordia-main-03', 'accordia-sub-03-08', 'Email Marketing', 8),
  ('accordia-main-03', 'accordia-sub-03-09', 'Influencer Marketing', 9),
  ('accordia-main-03', 'accordia-sub-03-10', 'Brand Strategy', 10),
  ('accordia-main-03', 'accordia-sub-03-11', 'Corporate Communications', 11),
  ('accordia-main-03', 'accordia-sub-03-12', 'Market Research', 12),
  ('accordia-main-04', 'accordia-sub-04-01', 'Sales Development', 1),
  ('accordia-main-04', 'accordia-sub-04-02', 'Business Development', 2),
  ('accordia-main-04', 'accordia-sub-04-03', 'Lead Generation', 3),
  ('accordia-main-04', 'accordia-sub-04-04', 'Account Management', 4),
  ('accordia-main-04', 'accordia-sub-04-05', 'Customer Acquisition', 5),
  ('accordia-main-04', 'accordia-sub-04-06', 'Telemarketing', 6),
  ('accordia-main-04', 'accordia-sub-04-07', 'Partnership Development', 7),
  ('accordia-main-04', 'accordia-sub-04-08', 'Sales Consulting', 8),
  ('accordia-main-04', 'accordia-sub-04-09', 'Channel & Distribution Sales', 9),
  ('accordia-main-04', 'accordia-sub-04-10', 'Customer Success', 10),
  ('accordia-main-05', 'accordia-sub-05-01', 'Business Strategy', 1),
  ('accordia-main-05', 'accordia-sub-05-02', 'Management Consulting', 2),
  ('accordia-main-05', 'accordia-sub-05-03', 'Startup Consulting', 3),
  ('accordia-main-05', 'accordia-sub-05-04', 'Operations Consulting', 4),
  ('accordia-main-05', 'accordia-sub-05-05', 'Process Improvement', 5),
  ('accordia-main-05', 'accordia-sub-05-06', 'Project Management', 6),
  ('accordia-main-05', 'accordia-sub-05-07', 'Procurement & Supply Chain Consulting', 7),
  ('accordia-main-05', 'accordia-sub-05-08', 'Change Management', 8),
  ('accordia-main-05', 'accordia-sub-05-09', 'Quality Management', 9),
  ('accordia-main-05', 'accordia-sub-05-10', 'Business Analysis', 10),
  ('accordia-main-05', 'accordia-sub-05-11', 'Franchise Consulting', 11),
  ('accordia-main-06', 'accordia-sub-06-01', 'Accounting & Bookkeeping', 1),
  ('accordia-main-06', 'accordia-sub-06-02', 'Audit & Assurance', 2),
  ('accordia-main-06', 'accordia-sub-06-03', 'Tax Services', 3),
  ('accordia-main-06', 'accordia-sub-06-04', 'Financial Advisory', 4),
  ('accordia-main-06', 'accordia-sub-06-05', 'Investment Services', 5),
  ('accordia-main-06', 'accordia-sub-06-06', 'Banking & Fintech', 6),
  ('accordia-main-06', 'accordia-sub-06-07', 'Insurance', 7),
  ('accordia-main-06', 'accordia-sub-06-08', 'Payroll Services', 8),
  ('accordia-main-06', 'accordia-sub-06-09', 'Credit & Lending', 9),
  ('accordia-main-06', 'accordia-sub-06-10', 'Financial Planning', 10),
  ('accordia-main-06', 'accordia-sub-06-11', 'Treasury & Corporate Finance', 11),
  ('accordia-main-07', 'accordia-sub-07-01', 'Corporate & Commercial Law', 1),
  ('accordia-main-07', 'accordia-sub-07-02', 'Intellectual Property', 2),
  ('accordia-main-07', 'accordia-sub-07-03', 'Technology & Startup Law', 3),
  ('accordia-main-07', 'accordia-sub-07-04', 'Contract Drafting & Review', 4),
  ('accordia-main-07', 'accordia-sub-07-05', 'Regulatory Compliance', 5),
  ('accordia-main-07', 'accordia-sub-07-06', 'Data Privacy', 6),
  ('accordia-main-07', 'accordia-sub-07-07', 'Risk Management', 7),
  ('accordia-main-07', 'accordia-sub-07-08', 'Corporate Governance', 8),
  ('accordia-main-07', 'accordia-sub-07-09', 'Dispute Resolution', 9),
  ('accordia-main-07', 'accordia-sub-07-10', 'Tax Law', 10),
  ('accordia-main-07', 'accordia-sub-07-11', 'Employment Law', 11),
  ('accordia-main-07', 'accordia-sub-07-12', 'Company Secretarial Services', 12),
  ('accordia-main-08', 'accordia-sub-08-01', 'Recruitment & Talent Acquisition', 1),
  ('accordia-main-08', 'accordia-sub-08-02', 'HR Consulting', 2),
  ('accordia-main-08', 'accordia-sub-08-03', 'Payroll & Compensation', 3),
  ('accordia-main-08', 'accordia-sub-08-04', 'Learning & Development', 4),
  ('accordia-main-08', 'accordia-sub-08-05', 'Performance Management', 5),
  ('accordia-main-08', 'accordia-sub-08-06', 'Employee Relations', 6),
  ('accordia-main-08', 'accordia-sub-08-07', 'Outsourcing & Staffing', 7),
  ('accordia-main-08', 'accordia-sub-08-08', 'Career Coaching', 8),
  ('accordia-main-08', 'accordia-sub-08-09', 'Background Verification', 9),
  ('accordia-main-08', 'accordia-sub-08-10', 'Workforce Planning', 10),
  ('accordia-main-09', 'accordia-sub-09-01', 'Electrical Engineering', 1),
  ('accordia-main-09', 'accordia-sub-09-02', 'Mechanical Engineering', 2),
  ('accordia-main-09', 'accordia-sub-09-03', 'Civil Engineering', 3),
  ('accordia-main-09', 'accordia-sub-09-04', 'Structural Engineering', 4),
  ('accordia-main-09', 'accordia-sub-09-05', 'Electronics Engineering', 5),
  ('accordia-main-09', 'accordia-sub-09-06', 'Telecommunications Engineering', 6),
  ('accordia-main-09', 'accordia-sub-09-07', 'Chemical Engineering', 7),
  ('accordia-main-09', 'accordia-sub-09-08', 'Industrial Engineering', 8),
  ('accordia-main-09', 'accordia-sub-09-09', 'Marine Engineering', 9),
  ('accordia-main-09', 'accordia-sub-09-10', 'Maintenance Engineering', 10),
  ('accordia-main-09', 'accordia-sub-09-11', 'Technical Consulting', 11),
  ('accordia-main-09', 'accordia-sub-09-12', 'Installation & Commissioning', 12),
  ('accordia-main-10', 'accordia-sub-10-01', 'Building Construction', 1),
  ('accordia-main-10', 'accordia-sub-10-02', 'Architecture', 2),
  ('accordia-main-10', 'accordia-sub-10-03', 'Quantity Surveying', 3),
  ('accordia-main-10', 'accordia-sub-10-04', 'Estate Surveying', 4),
  ('accordia-main-10', 'accordia-sub-10-05', 'Plumbing', 5),
  ('accordia-main-10', 'accordia-sub-10-06', 'Electrical Installation', 6),
  ('accordia-main-10', 'accordia-sub-10-07', 'HVAC', 7),
  ('accordia-main-10', 'accordia-sub-10-08', 'Carpentry & Joinery', 8),
  ('accordia-main-10', 'accordia-sub-10-09', 'Painting & Finishing', 9),
  ('accordia-main-10', 'accordia-sub-10-10', 'Roofing', 10),
  ('accordia-main-10', 'accordia-sub-10-11', 'Facility Management', 11),
  ('accordia-main-10', 'accordia-sub-10-12', 'Building Maintenance', 12),
  ('accordia-main-11', 'accordia-sub-11-01', 'Property Sales', 1),
  ('accordia-main-11', 'accordia-sub-11-02', 'Property Rentals', 2),
  ('accordia-main-11', 'accordia-sub-11-03', 'Property Management', 3),
  ('accordia-main-11', 'accordia-sub-11-04', 'Real Estate Development', 4),
  ('accordia-main-11', 'accordia-sub-11-05', 'Property Valuation', 5),
  ('accordia-main-11', 'accordia-sub-11-06', 'Facility Management', 6),
  ('accordia-main-11', 'accordia-sub-11-07', 'Short-Let Management', 7),
  ('accordia-main-11', 'accordia-sub-11-08', 'Property Marketing', 8),
  ('accordia-main-11', 'accordia-sub-11-09', 'Real Estate Consulting', 9),
  ('accordia-main-11', 'accordia-sub-11-10', 'Land & Property Services', 10),
  ('accordia-main-12', 'accordia-sub-12-01', 'General Manufacturing', 1),
  ('accordia-main-12', 'accordia-sub-12-02', 'Fabrication', 2),
  ('accordia-main-12', 'accordia-sub-12-03', 'Packaging', 3),
  ('accordia-main-12', 'accordia-sub-12-04', 'Printing', 4),
  ('accordia-main-12', 'accordia-sub-12-05', 'Textile & Garment Production', 5),
  ('accordia-main-12', 'accordia-sub-12-06', 'Furniture Manufacturing', 6),
  ('accordia-main-12', 'accordia-sub-12-07', 'Consumer Goods Manufacturing', 7),
  ('accordia-main-12', 'accordia-sub-12-08', 'Industrial Equipment', 8),
  ('accordia-main-12', 'accordia-sub-12-09', 'Machinery Services', 9),
  ('accordia-main-12', 'accordia-sub-12-10', 'Production Support', 10),
  ('accordia-main-12', 'accordia-sub-12-11', 'Quality Control', 11),
  ('accordia-main-12', 'accordia-sub-12-12', 'Industrial Maintenance', 12),
  ('accordia-main-13', 'accordia-sub-13-01', 'Oil & Gas', 1),
  ('accordia-main-13', 'accordia-sub-13-02', 'Renewable Energy', 2),
  ('accordia-main-13', 'accordia-sub-13-03', 'Solar Installation', 3),
  ('accordia-main-13', 'accordia-sub-13-04', 'Power & Electrical Energy', 4),
  ('accordia-main-13', 'accordia-sub-13-05', 'Utilities', 5),
  ('accordia-main-13', 'accordia-sub-13-06', 'Environmental Consulting', 6),
  ('accordia-main-13', 'accordia-sub-13-07', 'Waste Management', 7),
  ('accordia-main-13', 'accordia-sub-13-08', 'Recycling', 8),
  ('accordia-main-13', 'accordia-sub-13-09', 'Water Treatment', 9),
  ('accordia-main-13', 'accordia-sub-13-10', 'Sustainability & ESG', 10),
  ('accordia-main-13', 'accordia-sub-13-11', 'Energy Auditing', 11),
  ('accordia-main-13', 'accordia-sub-13-12', 'Environmental Health & Safety', 12),
  ('accordia-main-14', 'accordia-sub-14-01', 'Logistics & Delivery', 1),
  ('accordia-main-14', 'accordia-sub-14-02', 'Freight & Haulage', 2),
  ('accordia-main-14', 'accordia-sub-14-03', 'Courier Services', 3),
  ('accordia-main-14', 'accordia-sub-14-04', 'Warehousing', 4),
  ('accordia-main-14', 'accordia-sub-14-05', 'Supply Chain Services', 5),
  ('accordia-main-14', 'accordia-sub-14-06', 'Import & Export', 6),
  ('accordia-main-14', 'accordia-sub-14-07', 'Clearing & Forwarding', 7),
  ('accordia-main-14', 'accordia-sub-14-08', 'Fleet Management', 8),
  ('accordia-main-14', 'accordia-sub-14-09', 'Transportation Services', 9),
  ('accordia-main-14', 'accordia-sub-14-10', 'Automotive Sales', 10),
  ('accordia-main-14', 'accordia-sub-14-11', 'Vehicle Repairs & Maintenance', 11),
  ('accordia-main-14', 'accordia-sub-14-12', 'Mobility Services', 12),
  ('accordia-main-15', 'accordia-sub-15-01', 'General Retail', 1),
  ('accordia-main-15', 'accordia-sub-15-02', 'E-commerce', 2),
  ('accordia-main-15', 'accordia-sub-15-03', 'Fashion & Apparel', 3),
  ('accordia-main-15', 'accordia-sub-15-04', 'Beauty & Cosmetics', 4),
  ('accordia-main-15', 'accordia-sub-15-05', 'Jewellery & Accessories', 5),
  ('accordia-main-15', 'accordia-sub-15-06', 'Electronics', 6),
  ('accordia-main-15', 'accordia-sub-15-07', 'Furniture & Home Goods', 7),
  ('accordia-main-15', 'accordia-sub-15-08', 'Food & Grocery Retail', 8),
  ('accordia-main-15', 'accordia-sub-15-09', 'Luxury Goods', 9),
  ('accordia-main-15', 'accordia-sub-15-10', 'Wholesale & Distribution', 10),
  ('accordia-main-15', 'accordia-sub-15-11', 'General Merchandise', 11),
  ('accordia-main-15', 'accordia-sub-15-12', 'Consumer Products', 12),
  ('accordia-main-16', 'accordia-sub-16-01', 'Hotels & Accommodation', 1),
  ('accordia-main-16', 'accordia-sub-16-02', 'Restaurants & Catering', 2),
  ('accordia-main-16', 'accordia-sub-16-03', 'Food Services', 3),
  ('accordia-main-16', 'accordia-sub-16-04', 'Travel & Tourism', 4),
  ('accordia-main-16', 'accordia-sub-16-05', 'Travel Agency Services', 5),
  ('accordia-main-16', 'accordia-sub-16-06', 'Event Planning', 6),
  ('accordia-main-16', 'accordia-sub-16-07', 'Event Management', 7),
  ('accordia-main-16', 'accordia-sub-16-08', 'Event Production', 8),
  ('accordia-main-16', 'accordia-sub-16-09', 'Venue Services', 9),
  ('accordia-main-16', 'accordia-sub-16-10', 'Decoration', 10),
  ('accordia-main-16', 'accordia-sub-16-11', 'Entertainment Services', 11),
  ('accordia-main-16', 'accordia-sub-16-12', 'Hospitality Consulting', 12),
  ('accordia-main-17', 'accordia-sub-17-01', 'Medical Services', 1),
  ('accordia-main-17', 'accordia-sub-17-02', 'Nursing', 2),
  ('accordia-main-17', 'accordia-sub-17-03', 'Pharmacy', 3),
  ('accordia-main-17', 'accordia-sub-17-04', 'Dental Services', 4),
  ('accordia-main-17', 'accordia-sub-17-05', 'Laboratory Services', 5),
  ('accordia-main-17', 'accordia-sub-17-06', 'Mental Wellness Services', 6),
  ('accordia-main-17', 'accordia-sub-17-07', 'Nutrition', 7),
  ('accordia-main-17', 'accordia-sub-17-08', 'Fitness & Wellness', 8),
  ('accordia-main-17', 'accordia-sub-17-09', 'Physiotherapy', 9),
  ('accordia-main-17', 'accordia-sub-17-10', 'Beauty & Skincare', 10),
  ('accordia-main-17', 'accordia-sub-17-11', 'Hair & Grooming', 11),
  ('accordia-main-17', 'accordia-sub-17-12', 'Personal Care Services', 12),
  ('accordia-main-18', 'accordia-sub-18-01', 'Schools & Educational Institutions', 1),
  ('accordia-main-18', 'accordia-sub-18-02', 'Professional Training', 2),
  ('accordia-main-18', 'accordia-sub-18-03', 'Corporate Training', 3),
  ('accordia-main-18', 'accordia-sub-18-04', 'Online Education', 4),
  ('accordia-main-18', 'accordia-sub-18-05', 'Tutoring', 5),
  ('accordia-main-18', 'accordia-sub-18-06', 'Coaching & Mentorship', 6),
  ('accordia-main-18', 'accordia-sub-18-07', 'Academic Research', 7),
  ('accordia-main-18', 'accordia-sub-18-08', 'Educational Consulting', 8),
  ('accordia-main-18', 'accordia-sub-18-09', 'Certification Training', 9),
  ('accordia-main-18', 'accordia-sub-18-10', 'Skills Development', 10),
  ('accordia-main-18', 'accordia-sub-18-11', 'Language Services', 11),
  ('accordia-main-18', 'accordia-sub-18-12', 'Instructional Design', 12),
  ('accordia-main-19', 'accordia-sub-19-01', 'Crop Farming', 1),
  ('accordia-main-19', 'accordia-sub-19-02', 'Livestock', 2),
  ('accordia-main-19', 'accordia-sub-19-03', 'Poultry', 3),
  ('accordia-main-19', 'accordia-sub-19-04', 'Fisheries', 4),
  ('accordia-main-19', 'accordia-sub-19-05', 'Agribusiness', 5),
  ('accordia-main-19', 'accordia-sub-19-06', 'Agricultural Technology', 6),
  ('accordia-main-19', 'accordia-sub-19-07', 'Food Processing', 7),
  ('accordia-main-19', 'accordia-sub-19-08', 'Agricultural Supplies', 8),
  ('accordia-main-19', 'accordia-sub-19-09', 'Farm Management', 9),
  ('accordia-main-19', 'accordia-sub-19-10', 'Agricultural Consulting', 10),
  ('accordia-main-19', 'accordia-sub-19-11', 'Forestry', 11),
  ('accordia-main-19', 'accordia-sub-19-12', 'Natural Resources', 12),
  ('accordia-main-20', 'accordia-sub-20-01', 'Health & Safety Consulting', 1),
  ('accordia-main-20', 'accordia-sub-20-02', 'HSE Training', 2),
  ('accordia-main-20', 'accordia-sub-20-03', 'Fire Safety', 3),
  ('accordia-main-20', 'accordia-sub-20-04', 'Security Services', 4),
  ('accordia-main-20', 'accordia-sub-20-05', 'Surveillance & Access Control', 5),
  ('accordia-main-20', 'accordia-sub-20-06', 'Risk & Security Consulting', 6),
  ('accordia-main-20', 'accordia-sub-20-07', 'Cleaning Services', 7),
  ('accordia-main-20', 'accordia-sub-20-08', 'Pest Control', 8),
  ('accordia-main-20', 'accordia-sub-20-09', 'Facility Maintenance', 9),
  ('accordia-main-20', 'accordia-sub-20-10', 'Emergency Response', 10),
  ('accordia-main-20', 'accordia-sub-20-11', 'Occupational Health', 11),
  ('accordia-main-20', 'accordia-sub-20-12', 'Safety Equipment Supply', 12),
  ('accordia-main-21', 'accordia-sub-21-01', 'Cleaning', 1),
  ('accordia-main-21', 'accordia-sub-21-02', 'Laundry & Dry Cleaning', 2),
  ('accordia-main-21', 'accordia-sub-21-03', 'Home Maintenance', 3),
  ('accordia-main-21', 'accordia-sub-21-04', 'Home Improvement', 4),
  ('accordia-main-21', 'accordia-sub-21-05', 'Interior Decoration', 5),
  ('accordia-main-21', 'accordia-sub-21-06', 'Personal Assistance', 6),
  ('accordia-main-21', 'accordia-sub-21-07', 'Concierge Services', 7),
  ('accordia-main-21', 'accordia-sub-21-08', 'Childcare', 8),
  ('accordia-main-21', 'accordia-sub-21-09', 'Elder Care', 9),
  ('accordia-main-21', 'accordia-sub-21-10', 'Pet Services', 10),
  ('accordia-main-21', 'accordia-sub-21-11', 'Tailoring', 11),
  ('accordia-main-21', 'accordia-sub-21-12', 'Lifestyle Services', 12),
  ('accordia-main-22', 'accordia-sub-22-01', 'Government Services', 1),
  ('accordia-main-22', 'accordia-sub-22-02', 'Nonprofit Organisations', 2),
  ('accordia-main-22', 'accordia-sub-22-03', 'NGOs', 3),
  ('accordia-main-22', 'accordia-sub-22-04', 'Community Development', 4),
  ('accordia-main-22', 'accordia-sub-22-05', 'Social Enterprises', 5),
  ('accordia-main-22', 'accordia-sub-22-06', 'Humanitarian Services', 6),
  ('accordia-main-22', 'accordia-sub-22-07', 'Advocacy', 7),
  ('accordia-main-22', 'accordia-sub-22-08', 'International Development', 8),
  ('accordia-main-22', 'accordia-sub-22-09', 'Public Policy', 9),
  ('accordia-main-22', 'accordia-sub-22-10', 'Fundraising', 10),
  ('accordia-main-22', 'accordia-sub-22-11', 'Grant Management', 11),
  ('accordia-main-22', 'accordia-sub-22-12', 'Religious & Faith-Based Organisations', 12),
  ('accordia-main-23', 'accordia-sub-23-01', 'Sports Coaching', 1),
  ('accordia-main-23', 'accordia-sub-23-02', 'Fitness Training', 2),
  ('accordia-main-23', 'accordia-sub-23-03', 'Gyms & Fitness Centres', 3),
  ('accordia-main-23', 'accordia-sub-23-04', 'Sports Management', 4),
  ('accordia-main-23', 'accordia-sub-23-05', 'Sports Events', 5),
  ('accordia-main-23', 'accordia-sub-23-06', 'Recreation Services', 6),
  ('accordia-main-23', 'accordia-sub-23-07', 'Outdoor Activities', 7),
  ('accordia-main-23', 'accordia-sub-23-08', 'Esports & Gaming', 8),
  ('accordia-main-23', 'accordia-sub-23-09', 'Sports Media', 9),
  ('accordia-main-23', 'accordia-sub-23-10', 'Sports Equipment & Services', 10),
  ('accordia-main-24', 'accordia-sub-24-01', 'Emerging Technology', 1),
  ('accordia-main-24', 'accordia-sub-24-02', 'Specialized Professional Services', 2),
  ('accordia-main-24', 'accordia-sub-24-03', 'Multidisciplinary Business', 3),
  ('accordia-main-24', 'accordia-sub-24-04', 'New/Evolving Industry', 4),
  ('accordia-main-24', 'accordia-sub-24-05', 'Other', 5)
)
insert into public.categories (slug, name, sort_order, level, parent_id)
select seed.slug, seed.name, seed.sort_order, 'sub', parent.id
from seed join public.categories parent on parent.slug = seed.parent_slug
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order,
  level = 'sub', parent_id = excluded.parent_id;

create or replace function public.validate_category_hierarchy()
returns trigger language plpgsql as $$
declare parent_level text;
begin
  if new.level in ('main', 'legacy') then
    if new.parent_id is not null or new.created_by is not null then
      raise exception 'Main and legacy categories cannot have a parent or creator';
    end if;
  elsif new.level = 'sub' then
    select level into parent_level from public.categories where id = new.parent_id;
    if parent_level is distinct from 'main' or new.created_by is not null then
      raise exception 'Subcategories require a main-category parent';
    end if;
  else
    select level into parent_level from public.categories where id = new.parent_id;
    if parent_level is distinct from 'sub' or new.created_by is null then
      raise exception 'Service categories require a subcategory and professional creator';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists categories_validate_hierarchy on public.categories;
create trigger categories_validate_hierarchy before insert or update on public.categories
for each row execute function public.validate_category_hierarchy();

alter table public.professional_services
  add column if not exists is_visible_on_profile boolean not null default true,
  add column if not exists archived_at timestamptz,
  add column if not exists activity_anchor_at timestamptz not null default now(),
  add column if not exists pause_reason text;
alter table public.professional_services drop constraint if exists professional_services_pause_reason_check;
alter table public.professional_services add constraint professional_services_pause_reason_check
  check (pause_reason is null or pause_reason in ('manual', 'automatic'));
update public.professional_services
set activity_anchor_at = now(),
    pause_reason = case when is_active then null else 'manual' end;

create table if not exists public.professional_service_images (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.professional_services(id) on delete cascade,
  image_url text not null,
  position integer not null check (position between 0 and 4),
  created_at timestamptz not null default now(),
  unique(service_id, position)
);
insert into public.professional_service_images (service_id, image_url, position)
select id, image_url, 0 from public.professional_services
where image_url is not null and image_url <> ''
on conflict (service_id, position) do nothing;
alter table public.professional_service_images enable row level security;
create policy "service images are readable" on public.professional_service_images for select to authenticated
using (exists (select 1 from public.professional_services s where s.id = service_id
  and (s.professional_id = auth.uid() or s.archived_at is null and s.is_active and s.is_visible_on_profile)));
create policy "service role manages service images" on public.professional_service_images for all to service_role
using (true) with check (true);
grant select on public.professional_service_images to authenticated;
grant select, insert, update, delete on public.professional_service_images to service_role;

create or replace function public.replace_professional_service_images(p_service_id uuid, p_urls text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.professional_services
    where id = p_service_id and professional_id = auth.uid() and archived_at is null) then
    raise exception 'Service not found';
  end if;
  if p_urls is null or array_length(p_urls, 1) not between 1 and 5 then
    raise exception 'Add between one and five images';
  end if;
  delete from public.professional_service_images where service_id = p_service_id;
  insert into public.professional_service_images(service_id, image_url, position)
  select p_service_id, url, ordinal - 1 from unnest(p_urls) with ordinality as image(url, ordinal);
end;
$$;
revoke all on function public.replace_professional_service_images(uuid, text[]) from public, anon;
grant execute on function public.replace_professional_service_images(uuid, text[]) to authenticated, service_role;

create table if not exists public.professional_profile_views (
  id uuid primary key default gen_random_uuid(),
  view_key uuid not null unique,
  client_id uuid not null references public.profiles(id) on delete cascade,
  professional_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (client_id <> professional_id)
);
create index if not exists professional_profile_views_professional_idx
  on public.professional_profile_views(professional_id, created_at desc);
alter table public.professional_profile_views enable row level security;
create policy "professionals read their profile views" on public.professional_profile_views for select to authenticated
using (professional_id = auth.uid() or public.is_admin());
create policy "service role manages profile views" on public.professional_profile_views for all to service_role
using (true) with check (true);
grant select on public.professional_profile_views to authenticated;
grant select, insert on public.professional_profile_views to service_role;

create or replace function public.guard_new_appointment_service()
returns trigger language plpgsql as $$
begin
  if new.status = 'requested' and new.service_id is not null then
    perform 1 from public.professional_services s
    where s.id = new.service_id and s.professional_id = new.professional_id
      and s.offering_type = 'service' and s.is_active and s.is_visible_on_profile
      and s.archived_at is null and s.activity_anchor_at > now() - interval '90 days'
    for update;
    if not found then raise exception 'This service is not currently available for booking'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists appointments_guard_new_service on public.appointments;
create trigger appointments_guard_new_service before insert on public.appointments
for each row execute function public.guard_new_appointment_service();

create or replace function public.guard_open_availability_service()
returns trigger language plpgsql as $$
declare needs_check boolean;
begin
  if tg_op = 'INSERT' then
    needs_check := true;
  else
    needs_check := new.service_id is distinct from old.service_id or (old.is_paused and not new.is_paused);
  end if;
  if new.status = 'open' and needs_check then
    perform 1 from public.professional_services s
    where s.id = new.service_id and s.professional_id = new.professional_id
      and s.offering_type = 'service' and s.is_active and s.is_visible_on_profile
      and s.archived_at is null and s.activity_anchor_at > now() - interval '90 days'
    for share;
    if not found then raise exception 'Choose an active, visible service for this slot'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists availability_guard_open_service on public.professional_availability;
create trigger availability_guard_open_service before insert or update on public.professional_availability
for each row execute function public.guard_open_availability_service();

create or replace function public.record_service_request_activity()
returns trigger language plpgsql as $$
begin
  if new.status = 'requested' and new.service_id is not null then
    update public.professional_services set activity_anchor_at = greatest(activity_anchor_at, new.created_at)
    where id = new.service_id;
  end if;
  return new;
end;
$$;
drop trigger if exists appointments_record_service_request on public.appointments;
create trigger appointments_record_service_request after insert on public.appointments
for each row execute function public.record_service_request_activity();

create or replace function public.auto_pause_inactive_services()
returns integer language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.professional_services
  set is_active = false, pause_reason = 'automatic'
  where offering_type = 'service' and is_active and archived_at is null
    and activity_anchor_at <= now() - interval '90 days';
  get diagnostics affected = row_count;
  return affected;
end;
$$;
revoke all on function public.auto_pause_inactive_services() from public, anon, authenticated;
grant execute on function public.auto_pause_inactive_services() to service_role;

create extension if not exists pg_cron;
select cron.schedule('accordia-auto-pause-services', '0 2 * * *', $cron$select public.auto_pause_inactive_services()$cron$);

drop policy if exists "professional services are readable" on public.professional_services;
create or replace function public.can_read_service_history(p_service_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.appointments a where a.service_id = p_service_id and a.client_id = auth.uid())
    or exists (select 1 from public.professional_inquiries i where i.service_id = p_service_id and i.client_id = auth.uid());
$$;
revoke all on function public.can_read_service_history(uuid) from public, anon;
grant execute on function public.can_read_service_history(uuid) to authenticated, service_role;
create policy "professional services are readable" on public.professional_services for select to authenticated
using (professional_id = auth.uid() or public.is_admin() or
  (archived_at is null and is_active and is_visible_on_profile
    and (offering_type = 'product' or activity_anchor_at > now() - interval '90 days'))
  or public.can_read_service_history(id));
