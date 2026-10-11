"""POST /api/v1/imports/upload/: files that are not Excel workbooks.

Used to answer 500 (BadZipFile). Now 400 {"error": {"code": "BAD_FILE", ...}}, and
only the open/parse step is guarded: other failures must still surface.
"""
from __future__ import annotations

import io
from zipfile import BadZipFile

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client
from openpyxl import Workbook

from apps.accounts.models import User
from apps.imports.models import ImportLog

pytestmark = pytest.mark.django_db

URL = "/api/v1/imports/upload/"


@pytest.fixture
def admin():
    return User.objects.create_user(
        username="t_upload_admin", employee_id="t_upload_admin", full_name="Test admin", roles=["admin"]
    )


@pytest.fixture
def admin_client(admin):
    client = Client(raise_request_exception=False)
    client.force_login(admin)
    return client


@pytest.mark.parametrize("name", ["notes.xlsx", "legacy.xls"])
def test_text_pretending_to_be_excel_is_a_400(admin_client, name):
    resp = admin_client.post(URL, {"file": SimpleUploadedFile(name, b"plain text, not a workbook")})
    assert resp.status_code == 400
    error = resp.json()["error"]
    assert error["code"] == "BAD_FILE"
    assert error["message"]
    assert ImportLog.objects.count() == 0  # nothing was saved


@pytest.mark.parametrize("name", ["empty.xlsx", "empty.xls"])
def test_empty_file_is_a_400(admin_client, name):
    resp = admin_client.post(URL, {"file": SimpleUploadedFile(name, b"")})
    assert resp.status_code == 400  # xlrd itself would raise a bare TypeError for empty .xls content
    assert resp.json()["error"]["code"] == "BAD_FILE"
    assert ImportLog.objects.count() == 0


def test_a_real_workbook_still_reaches_persistence(admin_client):
    buffer = io.BytesIO()
    Workbook().save(buffer)
    resp = admin_client.post(URL, {"file": SimpleUploadedFile("blank.xlsx", buffer.getvalue())})
    assert resp.status_code == 200
    assert ImportLog.objects.count() == 1


def test_other_parser_errors_are_not_swallowed(admin, monkeypatch):
    def boom(file_bytes, file_name):
        raise RuntimeError("parser bug")

    monkeypatch.setattr("apps.imports.services.excel_parser.parse_qip_excel", boom)
    client = Client()  # re-raises server errors
    client.force_login(admin)
    with pytest.raises(RuntimeError, match="parser bug"):
        client.post(URL, {"file": SimpleUploadedFile("a.xlsx", b"x")})


def test_errors_after_parsing_are_not_reported_as_bad_file(admin, monkeypatch):
    """The guard covers parsing only: even a BadZipFile from the save step must surface."""

    def boom(*args, **kwargs):
        raise BadZipFile("raised while saving")

    monkeypatch.setattr("apps.imports.services.persistence.save_import_results", boom)
    buffer = io.BytesIO()
    Workbook().save(buffer)
    client = Client()
    client.force_login(admin)
    with pytest.raises(BadZipFile, match="raised while saving"):
        client.post(URL, {"file": SimpleUploadedFile("blank.xlsx", buffer.getvalue())})
