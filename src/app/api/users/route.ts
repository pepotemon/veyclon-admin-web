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
  role?: Role;       // rol del nuevo usuario (por defecto: collector)
  tenantId?: string; // opcional; si no viene, toma el del admin autenticado
};

// --- Helpers ---
function normUsuario(u: string) {
  return String(u || '').trim().toLowerCase();
}
function isValidRole(r: unknown): r is Role {
  return r === 'collector' || r === 'admin' || r === 'superadmin';
}

// Verifica que quien llama sea admin/superadmin.
// Si el token no trae claims, intenta leer Firestore y, si procede, sube claims para el próximo login.
async function requireAdmin(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) throw new Error('No token');

  const decoded = await adminAuth.verifyIdToken(token, true);
  const uid = decoded.uid;
  let role = (decoded as any).role as Role | undefined;
  let tenantId = (decoded as any).tenantId as string | undefined;

  // Fallback a Firestore si faltan claims
  if (!role || !tenantId) {
    const snap = await adminDb.collection('usuarios').doc(uid).get();
    if (snap.exists) {
      const data = snap.data() as { role?: Role; tenantId?: string };
      role = role ?? data.role;
      tenantId = tenantId ?? data.tenantId;

      if (role && tenantId && (role === 'admin' || role === 'superadmin')) {
        // Subimos claims para futuras sesiones (requiere re-login para reflejarse en el cliente)
        await adminAuth.setCustomUserClaims(uid, { role, tenantId });
      }
    }
  }

  if (!role || !tenantId || !['admin', 'superadmin'].includes(role)) {
    throw new Error('forbidden');
  }
  return { uid, role, tenantId };
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const body = (await req.json()) as CreateUserBody;

    const usuarioNorm = normUsuario(body.usuario);
    const pinStr = String(body.pin ?? '');
    const newUserRole: Role = isValidRole(body.role) ? body.role : 'collector';
    const effectiveTenant = body.tenantId ?? admin.tenantId;

    if (!usuarioNorm || !pinStr || !effectiveTenant) {
      return NextResponse.json({ error: 'Faltan campos requeridos' }, { status: 400 });
    }
    if (pinStr.length < 6) {
      return NextResponse.json({ error: 'El PIN debe tener al menos 6 caracteres' }, { status: 400 });
    }

    /** Reglas de creación por rol:
     * - Nadie puede crear 'superadmin' desde el panel.
     * - admin  -> solo 'collector'
     * - superadmin -> 'admin' o 'collector'
     */
    if (newUserRole === 'superadmin') {
      return NextResponse.json({ error: 'No se permite crear superadmin desde el panel' }, { status: 403 });
    }
    if (admin.role === 'admin' && newUserRole !== 'collector') {
      return NextResponse.json({ error: 'Un admin solo puede crear collectors' }, { status: 403 });
    }

    // Email sintético (no necesita existir)
    const email = `${usuarioNorm}@${effectiveTenant}.veyclon.local`;

    // 1) Crear en Auth
    const user = await adminAuth.createUser({
      email,
      password: pinStr,
      displayName: body.nombre?.trim() || body.usuario,
      disabled: false,
    });

    // 2) Claims del nuevo usuario
    const claims = {
      tenantId: effectiveTenant,
      role: newUserRole,
      rutaId: body.rutaId ?? null,
    } as const;
    await adminAuth.setCustomUserClaims(user.uid, claims);

    // 3) Perfil en Firestore
    await adminDb.collection('usuarios').doc(user.uid).set({
      tenantId: effectiveTenant,
      role: newUserRole,
      rutaId: body.rutaId ?? null,
      nombre: body.nombre?.trim() || body.usuario,
      ciudad: body.ciudad?.trim() || null,
      usuario: usuarioNorm,
      email,
      creadoPor: admin.uid,
      creadoEn: new Date().toISOString(),
      estado: 'activo',
    });

    return NextResponse.json({
      ok: true,
      uid: user.uid,
      email,
      claims,
    });
  } catch (err: unknown) {
    // Mapeo de errores comunes de firebase-admin
    let msg = err instanceof Error ? err.message : String(err);
    let status = 500;

    if (msg === 'No token') status = 401;
    else if (msg === 'forbidden') status = 403;

    // Errores de auth de Admin SDK
    if (typeof err === 'object' && err && 'code' in err) {
      const code = (err as any).code as string;
      if (code === 'auth/email-already-exists') {
        msg = 'Ya existe un usuario con ese identificador (usuario/tenant)';
        status = 409;
      } else if (code === 'auth/invalid-password') {
        msg = 'PIN inválido (revisa la longitud mínima de Firebase Auth, usualmente >= 6)';
        status = 400;
      } else if (code === 'auth/invalid-argument') {
        msg = 'Argumento inválido al crear usuario';
        status = 400;
      }
    }

    return NextResponse.json({ error: msg }, { status });
  }
}
