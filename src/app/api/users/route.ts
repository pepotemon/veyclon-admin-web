import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Role = 'collector' | 'admin' | 'superadmin';

type CreateUserBody = {
  usuario: string;
  pin: string | number;
  nombre?: string;
  rutaId?: string;
  ciudad?: string;
  role?: Role;
  tenantId?: string;
};

async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) throw new Error('No token');

  const decoded = await adminAuth.verifyIdToken(token, true);
  const role = decoded.role as Role | undefined;
  const tenantId = decoded.tenantId as string | undefined;

  if (!role || !['admin', 'superadmin'].includes(role)) throw new Error('forbidden');
  return { uid: decoded.uid, role, tenantId };
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = (await req.json()) as CreateUserBody;

    const role: Role = body.role ?? 'collector';
    const effectiveTenant = body.tenantId ?? admin.tenantId;

    if (!body.usuario || !body.pin || !effectiveTenant || !role) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }

    const pinStr = String(body.pin);
    if (pinStr.length < 6) {
      return NextResponse.json({ error: 'El PIN debe tener al menos 6 dígitos' }, { status: 400 });
    }

    const email = `${String(body.usuario).toLowerCase()}@${effectiveTenant}.veyclon.local`;

    // 1) Auth
    const user = await adminAuth.createUser({
      email,
      password: pinStr,
      displayName: body.nombre ?? body.usuario,
      disabled: false,
    });

    // 2) Claims
    await adminAuth.setCustomUserClaims(user.uid, {
      tenantId: effectiveTenant,
      role,
      rutaId: body.rutaId ?? null,
    });

    // 3) Perfil
    await adminDb.collection('usuarios').doc(user.uid).set({
      tenantId: effectiveTenant,
      role,
      rutaId: body.rutaId ?? null,
      nombre: body.nombre ?? body.usuario,
      ciudad: body.ciudad ?? null,
      usuario: body.usuario,
      email,
      creadoPor: admin.uid,
      creadoEn: new Date().toISOString(),
      estado: 'activo',
    });

    return NextResponse.json({ ok: true, uid: user.uid, email });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = msg === 'forbidden' ? 403 : msg === 'No token' ? 401 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
