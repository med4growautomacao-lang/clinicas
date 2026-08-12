# Migrations legadas (nunca aplicadas no banco)

Movidas para ca em **11/08/2026**. Nada foi apagado.

Sao 402 arquivos .sql cujo timestamp **nao existe** em `supabase_migrations.schema_migrations` do projeto de producao (`yzpclhuifquhfqpiwysh`).
Ou seja: o SQL deles nunca rodou no banco por esse caminho, ou rodou por fora e foi registrado com outro timestamp.

## Por que sairam de `supabase/migrations/`

Enquanto estavam la, qualquer reconstrucao do banco (`supabase start`, `supabase db reset`) executava esses arquivos
misturados por data com os que realmente rodaram, produzindo um banco **diferente do de producao** sem acusar erro.
Com eles fora, `supabase/migrations/` passa a conter apenas a historia real do banco.

## Nao apague

Servem de arqueologia: mostram intencao e data de trabalho que existiu. Para saber o que o banco tem HOJE,
consulte o banco vivo (`to_regclass`, `pg_get_viewdef`, `has_function_privilege`), nunca estes arquivos.
