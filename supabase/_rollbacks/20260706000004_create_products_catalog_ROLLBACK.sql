-- Rollback: remove o catalogo de produtos.
DROP POLICY IF EXISTS products_access ON public.products;
DROP TABLE IF EXISTS public.products;
