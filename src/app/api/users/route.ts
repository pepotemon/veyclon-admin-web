import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) throw new Error('No token');

  const decoded = await adminAuth.verifyIdToken(token, true);
  const role = decoded.role as string | undefined;
  const tenantId = decoded.tenantId as string | undefined;

  if (!role || !['admin', 'superadmin'].includes(role)) throw new Error('forbidden');
  return { uid: decoded.uid, role, tenantId };
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const { usuario, pin, nombre, rutaId, ciudad, role = 'collector', tenantId } = await req.json();

    const effectiveTenant = tenantId ?? admin.tenantId;
    if (!usuario || !pin || !effectiveTenant || !role) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }

    const pinStr = String(pin);
    if (pinStr.length < 6) {
      return NextResponse.json({ error: 'El PIN debe tener al menos 6 dígitos' }, { status: 400 });
    }

    const email = `${String(usuario).toLowerCase()}@${effectiveTenant}.veyclon.local`;

    const user = await adminAuth.createUser({
      email,
      password: pinStr,
      displayName: nombre ?? usuario,
      disabled: false,
    });

    await adminAuth.setCustomUserClaims(user.uid, {
      tenantId: effectiveTenant,
      role,
      rutaId: rutaId ?? null,
    });

    await adminDb.collection('usuarios').doc(user.uid).set({
      tenantId: effectiveTenant,
      role,
      rutaId: rutaId ?? null,
      nombre: nombre ?? usuario,
      ciudad: ciudad ?? null,
      usuario,
      email,
      creadoPor: admin.uid,
      creadoEn: new Date().toISOString(),
      estado: 'activo',
    });

    return NextResponse.json({ ok: true, uid: user.uid, email });
  } catch (e: any) {
    const msg = e?.message || 'error';
    const code = msg === 'forbidden' ? 403 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
