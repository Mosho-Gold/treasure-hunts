import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { evaluateFoggyReceipt } from './receipt_rules.ts'

const FOGGY = '222222222'
const STARFALL = '111111111'
const receipt = (status: string, listing: string) => ({ status, transactions: [{ listing_id: listing }] })

Deno.test('paid Foggy order passes', () => assertEquals(evaluateFoggyReceipt(receipt('paid', FOGGY), FOGGY), {ok:true,status:'paid'}))
Deno.test('completed Foggy order passes', () => assertEquals(evaluateFoggyReceipt(receipt('completed', FOGGY), FOGGY), {ok:true,status:'completed'}))
Deno.test('nonexistent order fails', () => assertEquals(evaluateFoggyReceipt(null, FOGGY).error, 'ORDER_NOT_FOUND'))
Deno.test('canceled order fails', () => assertEquals(evaluateFoggyReceipt(receipt('canceled', FOGGY), FOGGY).error, 'ORDER_CANCELED'))
Deno.test('unpaid order fails', () => assertEquals(evaluateFoggyReceipt(receipt('unpaid', FOGGY), FOGGY).error, 'ORDER_NOT_PAID'))
Deno.test('Starfall-only order cannot unlock Foggy', () => assertEquals(evaluateFoggyReceipt(receipt('paid', STARFALL), FOGGY).error, 'FOGGY_NOT_IN_ORDER'))
Deno.test('missing listing config fails', () => assertEquals(evaluateFoggyReceipt(receipt('paid', FOGGY), '').error, 'FOGGY_LISTING_NOT_CONFIGURED'))
Deno.test('missing transactions fails', () => assertEquals(evaluateFoggyReceipt({status:'paid'}, FOGGY).error, 'FOGGY_NOT_IN_ORDER'))
