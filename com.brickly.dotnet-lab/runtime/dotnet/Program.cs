using System.Text.Json;
using Syllm.Brickly.Sdk;

var runtime = new BricklyRuntime();

runtime.OnCommand("hello", (ctx, input) =>
{
    var name = input.ValueKind == JsonValueKind.Object && input.TryGetProperty("name", out var value)
        ? value.GetString()
        : null;
    ctx.Info("hello called", new Dictionary<string, object?> { ["name"] = name });
    return Task.FromResult<object?>(new Dictionary<string, object?>
    {
        ["message"] = "Hello, " + (name ?? "Brickly") + "!",
        ["sdk"] = Protocol.SdkVersion,
    });
});

runtime.OnCommand("live", async (ctx, input) =>
{
    ctx.HandleRequests(async (request, cancellationToken) =>
    {
        await Task.Delay(20, cancellationToken);
        return new Dictionary<string, object?> { ["echo"] = request };
    });

    for (var i = 1; i <= 4; i++)
    {
        await ctx.SendAsync(new Dictionary<string, object?> { ["progress"] = i / 4.0 });
        await Task.Delay(100, ctx.CancellationToken);
    }

    await ctx.Closed;
    return new Dictionary<string, object?> { ["done"] = true };
});

runtime.OnCommand("make-resource", async (ctx, input) =>
{
    var text = input.ValueKind == JsonValueKind.Object &&
               input.TryGetProperty("text", out var textValue) &&
               textValue.ValueKind == JsonValueKind.String
        ? textValue.GetString() ?? ""
        : "hello resource";
    var handle = await ctx.CreateResourceAsync(text, new ResourceCreateOptions { Name = "note.txt" });
    return handle;
});

runtime.OnCommand("read-resource", async (ctx, input) =>
{
    if (input.ValueKind != JsonValueKind.Object ||
        !input.TryGetProperty("reference", out var element))
    {
        throw new BppException("INVALID_INPUT", "reference is required");
    }
    // 命令面板 json 输入以字符串原文到达；程序化调用传入的则是对象。
    var json = element.ValueKind == JsonValueKind.String
        ? element.GetString() ?? ""
        : element.GetRawText();
    ResourceRef? reference;
    try
    {
        reference = JsonSerializer.Deserialize<ResourceRef>(
            json,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
    }
    catch (JsonException)
    {
        throw new BppException("INVALID_INPUT", "reference 必须是有效的 ResourceRef JSON");
    }
    if (reference is null)
    {
        throw new BppException("INVALID_INPUT", "reference is required");
    }
    var handle = runtime.OpenResource(reference);
    await using (handle)
    {
        var text = await handle.TextAsync();
        return new Dictionary<string, object?> { ["text"] = text };
    }
});

await runtime.StartAsync();
await runtime.WaitForShutdownAsync();
