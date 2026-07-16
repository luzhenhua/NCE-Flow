-- NCE-Flow 用户数据后端（OpenResty content_by_lua）
-- GET  读取 /app/data/userData.json（不存在则返回 {}）
-- POST 校验 JSON、限 5MB，临时文件 + os.rename 原子写入
-- 可选令牌：设置环境变量 NCE_DATA_TOKEN 后，请求需带 X-NCE-Token 头
local cjson = require "cjson.safe"

local DATA_DIR  = "/app/data"
local DATA_FILE = DATA_DIR .. "/userData.json"
local MAX_BYTES = 5 * 1024 * 1024

-- 令牌校验：未配置则开放；已配置则要求 X-NCE-Token 匹配
local function authorized()
  local tok = os.getenv("NCE_DATA_TOKEN")
  if not tok or tok == "" then return true end
  return ngx.var.http_x_nce_token == tok
end

local function deny()
  ngx.status = 401
  ngx.print('{"error":"unauthorized"}')   -- X-NCE-Storage 头由 nginx 统一附加，前端据此区分“需令牌”与“无后端”
end

local method = ngx.req.get_method()

if method == "GET" then
  if not authorized() then return deny() end
  local f = io.open(DATA_FILE, "r")
  if not f then ngx.print("{}"); return end
  local body = f:read("*a")
  f:close()
  ngx.print((body and body ~= "") and body or "{}")
  return
end

if method == "POST" then
  if not authorized() then return deny() end
  ngx.req.read_body()
  local body = ngx.req.get_body_data()
  if not body then
    local fp = ngx.req.get_body_file()   -- body 超过缓冲区时会落盘，从临时文件读取
    if fp then
      local bf = io.open(fp, "r")
      if bf then body = bf:read("*a"); bf:close() end
    end
  end
  if not body or #body == 0 then
    ngx.status = 400; ngx.print('{"error":"empty"}'); return
  end
  if #body > MAX_BYTES then
    ngx.status = 413; ngx.print('{"error":"too_large"}'); return
  end
  if cjson.decode(body) == nil then       -- 仅接受可解析的 JSON
    ngx.status = 400; ngx.print('{"error":"bad_json"}'); return
  end
  local tmp = DATA_FILE .. ".tmp." .. ngx.worker.pid()
  local wf = io.open(tmp, "w")
  if not wf then
    ngx.status = 500; ngx.print('{"error":"write_failed"}'); return
  end
  wf:write(body)
  wf:close()
  if not os.rename(tmp, DATA_FILE) then   -- 同目录 rename，原子替换
    os.remove(tmp)
    ngx.status = 500; ngx.print('{"error":"rename_failed"}'); return
  end
  ngx.print('{"ok":true}')
  return
end

ngx.status = 405
ngx.print('{"error":"method_not_allowed"}')
