using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Hormes.Hands;

/// <summary>A failed op: the wire code (bad_request, permission_denied, capture_failed, not_found, internal, busy, focus_moved) and a message.</summary>
internal sealed class HandsException : Exception
{
    public string Code { get; }
    public HandsException(string code, string message) : base(message) { Code = code; }
    public static HandsException BadRequest(string m) => new("bad_request", m);
    public static HandsException NotFound(string m) => new("not_found", m);
    public static HandsException CaptureFailed(string m) => new("capture_failed", m);
    public static HandsException Internal(string m) => new("internal", m);
}

/// <summary>Defensive, typed access to a request's top-level parameters (Protocol.swift's Params).</summary>
internal sealed class Params
{
    private readonly JsonElement _obj;
    public Params(JsonElement obj) { _obj = obj; }

    private JsonElement? Raw(string key)
    {
        if (!_obj.TryGetProperty(key, out var v) || v.ValueKind == JsonValueKind.Null) return null;
        return v;
    }

    public bool Has(string key) => Raw(key) is not null;

    public double? Double(string key)
    {
        var v = Raw(key);
        if (v is null) return null;
        if (v.Value.ValueKind != JsonValueKind.Number || !v.Value.TryGetDouble(out var d) || double.IsNaN(d) || double.IsInfinity(d))
            throw HandsException.BadRequest($"'{key}' must be a finite number");
        return d;
    }

    public double RequireDouble(string key) => Double(key) ?? throw HandsException.BadRequest($"'{key}' is required");

    public int? Int(string key)
    {
        var d = Double(key);
        if (d is null) return null;
        if (Math.Abs(d.Value) > 2e9) throw HandsException.BadRequest($"'{key}' is out of range");
        return (int)Math.Round(d.Value);
    }

    public int RequireInt(string key) => Int(key) ?? throw HandsException.BadRequest($"'{key}' is required");

    public bool? Bool(string key)
    {
        var v = Raw(key);
        if (v is null) return null;
        return v.Value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => throw HandsException.BadRequest($"'{key}' must be a boolean"),
        };
    }

    public string? String(string key)
    {
        var v = Raw(key);
        if (v is null) return null;
        if (v.Value.ValueKind != JsonValueKind.String) throw HandsException.BadRequest($"'{key}' must be a string");
        return v.Value.GetString();
    }

    public string RequireString(string key) => String(key) ?? throw HandsException.BadRequest($"'{key}' is required");

    public List<string>? StringArray(string key)
    {
        var v = Raw(key);
        if (v is null) return null;
        if (v.Value.ValueKind != JsonValueKind.Array) throw HandsException.BadRequest($"'{key}' must be an array of strings");
        var list = new List<string>();
        foreach (var item in v.Value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String) throw HandsException.BadRequest($"'{key}' must be an array of strings");
            list.Add(item.GetString() ?? "");
        }
        return list;
    }

    public List<int>? IntArray(string key)
    {
        var v = Raw(key);
        if (v is null) return null;
        if (v.Value.ValueKind != JsonValueKind.Array) throw HandsException.BadRequest($"'{key}' must be an array of numbers");
        var list = new List<int>();
        foreach (var item in v.Value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Number || !item.TryGetDouble(out var d)) throw HandsException.BadRequest($"'{key}' must be an array of numbers");
            list.Add((int)Math.Round(d));
        }
        return list;
    }

    public Params? Object(string key)
    {
        var v = Raw(key);
        if (v is null) return null;
        if (v.Value.ValueKind != JsonValueKind.Object) throw HandsException.BadRequest($"'{key}' must be an object");
        return new Params(v.Value);
    }

    /// <summary>A required {x, y} object.</summary>
    public (double X, double Y) Point(string key)
    {
        var o = Object(key) ?? throw HandsException.BadRequest($"'{key}' is required");
        return (o.RequireDouble("x"), o.RequireDouble("y"));
    }

    /// <summary>Optional top-level x/y pair. Both or neither.</summary>
    public (double X, double Y)? OptionalXY()
    {
        var x = Double("x");
        var y = Double("y");
        if (x is null && y is null) return null;
        if (x is null || y is null) throw HandsException.BadRequest("'x' and 'y' must be given together");
        return (x.Value, y.Value);
    }

    public (double X, double Y) RequireXY() => (RequireDouble("x"), RequireDouble("y"));

    public JsonElement.ObjectEnumerator Properties => _obj.EnumerateObject();
}

internal static class Json
{
    public static Dictionary<string, object?> Rect(double x, double y, double w, double h) =>
        new() { ["x"] = x, ["y"] = y, ["w"] = w, ["h"] = h };

    public static Dictionary<string, object?> Rect(Native.RECT r) => Rect(r.Left, r.Top, r.Width, r.Height);

    public static Dictionary<string, object?> Point(double x, double y) => new() { ["x"] = x, ["y"] = y };
}
