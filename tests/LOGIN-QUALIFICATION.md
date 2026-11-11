# Login qualification controls

These tests do not download, install or launch EVE. The product ZIP includes test
sources, not private native-server/third-party fixtures or retained evidence.
Tests that need those inputs require separately supplied, authorized fixtures.

Use Node.js and Python 3. Set EVEJS_PYTHON when Python is not on PATH.
EVEJS_LOGIN_NATIVE_ROOT selects an existing EveJS server source fixture;
EVEJS_LOGIN_VENDOR_ROOT selects retained third-party loader/codec fixtures.
EVEJS_LOGIN_CAPTURED_MENU selects a captured Launcher Shared Mods loader.
See each harness for its expected layout. No missing fixture is downloaded.

tests/qualify-login-delivery.cjs accepts --runtime, --out, --python and
--legacy-root. The optional older adapter is inspected only when supplied through
--legacy-root or EVEJS_LOGIN_LEGACY_ROOT. Fixture labels do not attest provenance.
The separate loadout runner additionally requires retained package identities and
third-party fixtures. Reports go into the test workspace beside this mod folder.

tests/client-archive-migration.cjs is a Windows-only authored archive/journal
control. Set EVEJS_TEST_MINING_SOURCE to an existing supported miningRuntime.js.
It operates only on its synthetic test-work/client-delivery-migration archive,
never on the supplied server source. Run it in a dedicated writable test workspace.
tests/qualify-client-delivery.cjs reuses that control's evidence; it deliberately
does not invoke archive operations automatically.

tests/test_menu.py accepts the public Launcher shared_menu.py path as its first
argument. It uses an authored menu factory and does not instantiate native UI.
The frozen old-runtime fixture is a negative regression control, never a product
import. Gameplay, real client UI and soak qualification remain separate work.
