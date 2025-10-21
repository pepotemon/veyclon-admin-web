import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'No token' }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token, true);
    const uid = decoded.uid;

    const snap = await adminDb.collection('usuarios').doc(uid).get();
    const perfil = snap.exists ? snap.data() : null;

    return NextResponse.json({
      decodedClaims: {
        uid,
        role: (decoded as any).role ?? null,
        tenantId: (decoded as any).tenantId ?? null,
        rutaId: (decoded as any).rutaId ?? null,
        email: decoded.email ?? null,
      },
      firestorePerfil: perfil,
      ok: true,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
