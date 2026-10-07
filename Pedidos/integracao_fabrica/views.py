"""Projeções dos pedidos atuais para a prévia visual de cada setor."""
from __future__ import annotations

from .core import ORDER_FIELDS_BY_ROLE


ITEM_FIELDS = {
    "comercial": {"art", "service", "quantity", "unit", "fabric", "width_m", "price", "billing_meters", "total", "asset_id", "original_name"},
    "estoque": {"art", "quantity", "unit", "fabric", "width_m", "asset_id"},
    "digital": {"art", "service", "quantity", "unit", "fabric", "width_m", "asset_id", "original_name", "original_path"},
    "preparacao": {"art", "quantity", "unit", "fabric", "width_m", "asset_id"},
    "calandra": {"art", "quantity", "unit", "fabric", "width_m", "asset_id"},
    "corte": {"art", "quantity", "unit", "fabric", "asset_id"},
    "costura": {"art", "quantity", "unit", "fabric", "asset_id"},
    "revisao": {"art", "service", "quantity", "unit", "fabric", "width_m", "asset_id"},
    "expedicao": {"art", "quantity", "unit", "fabric", "asset_id"},
    "financeiro": {"art", "service", "quantity", "unit", "price", "billing_meters", "total"},
    "pcp": {"art", "service", "quantity", "unit", "fabric", "width_m", "asset_id", "original_name", "original_path"},
    "gestao": {"art", "service", "quantity", "unit", "fabric", "width_m", "price", "billing_meters", "total", "asset_id", "original_name", "original_path"},
}


def project_order(source: dict, role: str) -> dict:
    if role not in ORDER_FIELDS_BY_ROLE:
        raise PermissionError("Perfil inválido")
    fields = {"number", "created_at"} | ORDER_FIELDS_BY_ROLE[role]
    if role in {"comercial", "financeiro", "gestao"}:
        fields |= {"nf", "total", "pending_prices"}
    if role in {"comercial", "gestao"}:
        fields.add("notes")
    result = {key: value for key, value in source.items() if key in fields}
    result["items"] = [
        {key: value for key, value in item.items() if key == "id" or key in ITEM_FIELDS[role]}
        for item in source["items"]
    ]
    result["stage_status"] = "Prévia visual · sem apontamentos do setor"
    return result
