-- AI-assisted technical validation. Synthetic fixtures only; all fixture writes
-- are enclosed in a PL/pgSQL subtransaction deliberately rolled back at the end.
-- JWT claims are simulated database contexts, not Auth-issued sessions.
CREATE TEMP TABLE rq2_validation_result(payload jsonb) ON COMMIT DROP;
DO $validation$
DECLARE
  results jsonb := '[]'::jsonb;
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  i uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); cb uuid:=gen_random_uuid();
  sa uuid:=gen_random_uuid(); sb uuid:=gen_random_uuid(); ca uuid:=gen_random_uuid(); catb uuid:=gen_random_uuid();
  pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid(); sale uuid:=gen_random_uuid(); badsale uuid:=gen_random_uuid();
  n bigint; stock numeric; err text; st text; ok boolean; leaked uuid;
  tag text:='RQ2_VALIDATION_'||replace(gen_random_uuid()::text,'-','');
BEGIN
 BEGIN
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
   (a,lower(tag)||'_a@example.invalid',jsonb_build_object('name',tag||' Admin A')),
   (b,lower(tag)||'_b@example.invalid',jsonb_build_object('name',tag||' Admin B')),
   (c,lower(tag)||'_c@example.invalid',jsonb_build_object('name',tag||' Cashier A')),
   (i,lower(tag)||'_i@example.invalid',jsonb_build_object('name',tag||' Inventory A')),
   (s,lower(tag)||'_s@example.invalid',jsonb_build_object('name',tag||' Super Admin')),
   (m,lower(tag)||'_m@example.invalid',jsonb_build_object('name',tag||' MFA Admin')),
   (cb,lower(tag)||'_cb@example.invalid',jsonb_build_object('name',tag||' Cashier B'));
  UPDATE public.profiles SET role='admin' WHERE id IN (a,b,m);
  UPDATE public.profiles SET role='inventory' WHERE id=i;
  UPDATE public.profiles SET role='super_admin' WHERE id=s;
  INSERT INTO public.stores(id,name,owner_id,tax_rate) VALUES(sa,tag||' Store A',a,0),(sb,tag||' Store B',b,0);
  INSERT INTO public.store_users(store_id,profile_id) VALUES(sa,a),(sa,c),(sa,i),(sa,m),(sb,b),(sb,cb);
  INSERT INTO public.categories(id,name,store_id,owner_id) VALUES(ca,tag||' Category A',sa,a),(catb,tag||' Category B',sb,b);
  INSERT INTO public.products(id,name,sku,category_id,store_id,cost_price,selling_price,current_stock)
   VALUES(pa,tag||' Product A',tag||'-A',ca,sa,5,10,10),(pb,tag||' Product B',tag||'-B',catb,sb,5,10,10);

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','aal','aal1')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.products WHERE id=pa;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB01','test','Admin reads assigned-store product','passed',n=1,'observed_rows',n));
  SELECT count(*) INTO n FROM public.products WHERE id=pb;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB02','test','Admin cannot read other-store product','passed',n=0,'observed_rows',n));
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',c,'role','authenticated','aal','aal1')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.products WHERE id=pa;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB03','test','Cashier reads assigned-store product','passed',n=1,'observed_rows',n));
  BEGIN
   UPDATE public.products SET name=tag||' Unauthorized' WHERE id=pa; GET DIAGNOSTICS n=ROW_COUNT;
   results:=results||jsonb_build_array(jsonb_build_object('id','DB04','test','Cashier cannot edit product','passed',n=0,'observed_rows',n));
  EXCEPTION WHEN insufficient_privilege THEN
   results:=results||jsonb_build_array(jsonb_build_object('id','DB04','test','Cashier cannot edit product','passed',true,'sqlstate',SQLSTATE));
  END;
  BEGIN
   UPDATE public.profiles SET role='admin' WHERE id=c; GET DIAGNOSTICS n=ROW_COUNT;
   results:=results||jsonb_build_array(jsonb_build_object('id','DB05','test','Cashier cannot promote own role','passed',n=0,'observed_rows',n));
  EXCEPTION WHEN insufficient_privilege THEN
   results:=results||jsonb_build_array(jsonb_build_object('id','DB05','test','Cashier cannot promote own role','passed',true,'sqlstate',SQLSTATE));
  END;
  BEGIN
   PERFORM public.process_pos_sale_v4(badsale,sa,c,2,0,0,2,50,48,jsonb_build_array(jsonb_build_object('productId',pa,'quantity',2)),'cash');
   results:=results||jsonb_build_array(jsonb_build_object('id','DB06','test','Server rejects tampered checkout totals','passed',false));
  EXCEPTION WHEN OTHERS THEN
   err:=SQLERRM;results:=results||jsonb_build_array(jsonb_build_object('id','DB06','test','Server rejects tampered checkout totals','passed',err LIKE 'Submitted sale totals do not match%','error',err));
  END;
  SELECT count(*) INTO n FROM public.sales WHERE id=badsale;
  SELECT current_stock INTO stock FROM public.products WHERE id=pa;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB07','test','Rejected checkout leaves no sale and stock unchanged','passed',n=0 AND stock=10,'sale_rows',n,'stock',stock));
  PERFORM public.process_pos_sale_v4(sale,sa,c,20,0,0,20,50,30,jsonb_build_array(jsonb_build_object('productId',pa,'quantity',2)),'cash');
  SELECT current_stock INTO stock FROM public.products WHERE id=pa;
  SELECT count(*) INTO n FROM public.receipts WHERE sale_id=sale;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB08','test','Valid checkout deducts stock and creates receipt','passed',stock=8 AND n=1,'stock',stock,'receipt_rows',n));
  PERFORM public.process_pos_sale_v4(sale,sa,c,20,0,0,20,50,30,jsonb_build_array(jsonb_build_object('productId',pa,'quantity',2)),'cash');
  SELECT current_stock INTO stock FROM public.products WHERE id=pa;
  SELECT count(*) INTO n FROM public.sales WHERE id=sale;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB09','test','Repeated sale ID does not deduct twice','passed',stock=8 AND n=1,'stock',stock,'sale_rows',n));
  BEGIN
   PERFORM public.process_pos_sale_v4(gen_random_uuid(),sa,c,1000,0,0,1000,1000,0,jsonb_build_array(jsonb_build_object('productId',pa,'quantity',100)),'cash');
   results:=results||jsonb_build_array(jsonb_build_object('id','DB10','test','Insufficient stock rejected','passed',false));
  EXCEPTION WHEN OTHERS THEN
   err:=SQLERRM;results:=results||jsonb_build_array(jsonb_build_object('id','DB10','test','Insufficient stock rejected','passed',err LIKE 'Insufficient base stock%','error',err));
  END;
  BEGIN
   PERFORM public.process_pos_sale_v4(gen_random_uuid(),sb,c,20,0,0,20,50,30,jsonb_build_array(jsonb_build_object('productId',pb,'quantity',2)),'cash');
   results:=results||jsonb_build_array(jsonb_build_object('id','DB11','test','Cross-store checkout rejected','passed',false));
  EXCEPTION WHEN OTHERS THEN
   err:=SQLERRM;results:=results||jsonb_build_array(jsonb_build_object('id','DB11','test','Cross-store checkout rejected','passed',err='User is not assigned to this store','error',err));
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',i,'role','authenticated','aal','aal1')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.products SET name=tag||' Inventory edit' WHERE id=pa; GET DIAGNOSTICS n=ROW_COUNT;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB12','test','Inventory role edits assigned product','passed',n=1,'observed_rows',n));
  BEGIN
   PERFORM public.process_pos_sale_v4(gen_random_uuid(),sa,i,20,0,0,20,50,30,jsonb_build_array(jsonb_build_object('productId',pa,'quantity',2)),'cash');
   results:=results||jsonb_build_array(jsonb_build_object('id','DB13','test','Inventory role cannot process POS sale','passed',false));
  EXCEPTION WHEN OTHERS THEN
   err:=SQLERRM;results:=results||jsonb_build_array(jsonb_build_object('id','DB13','test','Inventory role cannot process POS sale','passed',err='Only store admins or cashiers can process sales','error',err));
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',s,'role','authenticated','aal','aal1')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.products WHERE id=pa;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB14','test','Unassigned Super Admin cannot read store product','passed',n=0,'observed_rows',n));
  BEGIN
   PERFORM public.process_pos_sale_v4(gen_random_uuid(),sa,s,20,0,0,20,50,30,jsonb_build_array(jsonb_build_object('productId',pa,'quantity',2)),'cash');
   results:=results||jsonb_build_array(jsonb_build_object('id','DB15','test','Super Admin cannot process POS sale','passed',false));
  EXCEPTION WHEN OTHERS THEN
   err:=SQLERRM;results:=results||jsonb_build_array(jsonb_build_object('id','DB15','test','Super Admin cannot process POS sale','passed',err='Only store admins or cashiers can process sales','error',err));
  END;
  EXECUTE 'RESET ROLE';

  INSERT INTO auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at,secret)
   VALUES(gen_random_uuid(),m,'totp','verified',now(),now(),'synthetic-test-factor-not-a-real-secret');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','aal','aal1')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_belongs_to_store(sa) INTO ok;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB16','test','Enrolled MFA user at AAL1 fails store authorization','passed',NOT ok,'store_access',ok));
  BEGIN
   PERFORM public.create_store_with_owner(tag||' MFA bypass probe','synthetic',0);
   results:=results||jsonb_build_array(jsonb_build_object('id','DB17','test','Enrolled MFA user at AAL1 cannot create store','passed',false,'observed','Store created despite missing second factor'));
  EXCEPTION WHEN OTHERS THEN
   err:=SQLERRM;results:=results||jsonb_build_array(jsonb_build_object('id','DB17','test','Enrolled MFA user at AAL1 cannot create store','passed',err LIKE '%MFA%' OR err LIKE '%assurance%' OR err LIKE '%Only admins%','error',err));
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','aal','aal2')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.user_belongs_to_store(sa) INTO ok;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB18','test','Enrolled MFA user at AAL2 passes assigned-store authorization','passed',ok,'store_access',ok));
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims',jsonb_build_object('role','anon')::text,true);
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
   SELECT count(*) INTO n FROM public.products WHERE id=pa;
   results:=results||jsonb_build_array(jsonb_build_object('id','DB19','test','Anonymous user cannot read product','passed',n=0,'observed_rows',n));
  EXCEPTION WHEN insufficient_privilege THEN
   results:=results||jsonb_build_array(jsonb_build_object('id','DB19','test','Anonymous user cannot read product','passed',true,'sqlstate',SQLSTATE));
  END;
  BEGIN
   leaked:=public.log_audit_event(NULL,tag,'synthetic-validation',NULL,'{}');
   results:=results||jsonb_build_array(jsonb_build_object('id','DB20','test','Anonymous user cannot insert audit event via RPC','passed',false,'observed','Unauthenticated audit event accepted'));
  EXCEPTION WHEN OTHERS THEN
   err:=SQLERRM;results:=results||jsonb_build_array(jsonb_build_object('id','DB20','test','Anonymous user cannot insert audit event via RPC','passed',SQLSTATE='42501' OR err LIKE '%Authentication required%','error',err));
  END;
  EXECUTE 'RESET ROLE';

  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',a,'role','authenticated','aal','aal1')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  UPDATE public.products SET selling_price=12 WHERE id=pa;
  SELECT count(*) INTO n FROM public.sale_items WHERE sale_id=sale AND unit_price=10 AND line_total=20;
  results:=results||jsonb_build_array(jsonb_build_object('id','DB21','test','Historical sale price survives current price change','passed',n=1,'snapshot_rows',n));
  BEGIN
   DELETE FROM public.profiles WHERE id=cb; GET DIAGNOSTICS n=ROW_COUNT;
   results:=results||jsonb_build_array(jsonb_build_object('id','DB22','test','Store A Admin cannot delete Store B profile','passed',n=0,'deleted_synthetic_rows',n));
  EXCEPTION WHEN insufficient_privilege THEN
   results:=results||jsonb_build_array(jsonb_build_object('id','DB22','test','Store A Admin cannot delete Store B profile','passed',true,'sqlstate',SQLSTATE));
  END;
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION USING ERRCODE='ZQ201',MESSAGE='ROLLBACK_SYNTHETIC_VALIDATION_FIXTURES';
 EXCEPTION
  WHEN SQLSTATE 'ZQ201' THEN NULL;
  WHEN OTHERS THEN results:=results||jsonb_build_array(jsonb_build_object('id','HARNESS','passed',false,'error',SQLERRM,'sqlstate',SQLSTATE));
 END;
 SELECT count(*) INTO n FROM auth.users WHERE id IN(a,b,c,i,s,m,cb);
 INSERT INTO rq2_validation_result(payload) VALUES(jsonb_build_object('results',results,'remaining_fixture_auth_users',n,'fixture_transaction_rolled_back',n=0,'context','Database role and JWT-claim simulation; not an Auth login or MFA-code challenge'));
END $validation$;
SELECT payload FROM rq2_validation_result;
