import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Role = 'collector' | 'admin' | 'superadmin';

export async function POST(req: NextRequest) {
  try {
    const authz = req.headers.get('authorization') || '';
    const secret = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!secret || secret !== process.env.BOOTSTRAP_SECRET) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const { email, role, tenantId } = (await req.json()) as {
      email: string;
      role?: Role;
      tenantId: string;
    };

    if (!email || !tenantId) {
      return NextResponse.json({ error: 'email y tenantId son requeridos' }, { status: 400 });
    }
    const targetRole: Role = role ?? 'superadmin';
    if (targetRole !== 'admin' && targetRole !== 'superadmin') {
      return NextResponse.json({ error: 'role inválido' }, { status: 400 });
    }

    // 1) Busca el usuario por email
    const user = await adminAuth.getUserByEmail(email);

    // 2) Sube custom claims
    await adminAuth.setCustomUserClaims(user.uid, {
      role: targetRole,
      tenantId,
      rutaId: null,
    });

    // 3) Crea/actualiza perfil en Firestore
    await adminDb.collection('usuarios').doc(user.uid).set(
      {
        tenantId,
        role: targetRole,
        rutaId: null,
        usuario: email,     // informativo
        email,
        estado: 'activo',
        creadoPor: 'bootstrap',
        creadoEn: new Date().toISOString(),
        nombre: 'Super Admin',
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, uid: user.uid, email, role: targetRole, tenantId });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
