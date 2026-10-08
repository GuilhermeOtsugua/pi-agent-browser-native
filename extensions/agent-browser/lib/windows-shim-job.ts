/** Job lifetime for the legacy PowerShell/.cmd path only. No compiler or external
 * process may run before the launcher joins its kill-on-close job. The sole job
 * handle is non-inheritable: forcibly terminating PowerShell closes it, and the
 * kernel terminates every member, including children created during cancellation.
 */
export const WINDOWS_SHIM_JOB_FAILURE_MARKER = "PI_AGENT_BROWSER_WINDOWS_JOB_FAILED:";

export function protectWindowsShimInvocation(invocation: string): string {
	return String.raw`
$ErrorActionPreference = 'Stop';
try {
  $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly((New-Object Reflection.AssemblyName('PiBrowserShimJob')), [Reflection.Emit.AssemblyBuilderAccess]::Run);
  $module = $assembly.DefineDynamicModule('Win32');
  $type = $module.DefineType('PiBrowserShimJob', [Reflection.TypeAttributes]'Public, Abstract, Sealed');
  function Define-Native($name, $result, [Type[]]$parameters) {
    $method = $type.DefinePInvokeMethod($name, 'kernel32.dll', [Reflection.MethodAttributes]'Public, Static, PinvokeImpl', [Reflection.CallingConventions]::Standard, $result, $parameters, [Runtime.InteropServices.CallingConvention]::Winapi, [Runtime.InteropServices.CharSet]::Unicode);
    $method.SetImplementationFlags($method.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig);
  };
  Define-Native 'CreateJobObjectW' ([IntPtr]) @([IntPtr], [string]);
  Define-Native 'SetInformationJobObject' ([bool]) @([IntPtr], [int], [IntPtr], [uint32]);
  Define-Native 'AssignProcessToJobObject' ([bool]) @([IntPtr], [IntPtr]);
  Define-Native 'GetCurrentProcess' ([IntPtr]) @();
  Define-Native 'CloseHandle' ([bool]) @([IntPtr]);
  $native = $type.CreateType();
  $job = $native::CreateJobObjectW([IntPtr]::Zero, $null);
  if ($job -eq [IntPtr]::Zero) { throw 'CreateJobObjectW failed' };
  # JOBOBJECT_EXTENDED_LIMIT_INFORMATION: two LARGE_INTEGERs, DWORD
  # LimitFlags at byte 16, then SIZE_T fields, affinity, DWORDs,
  # IO_COUNTERS (six ULONGLONGs), and four SIZE_T memory limits.
  # Windows ABI size: 144 on 64-bit, 112 on 32-bit. Information class 9.
  $size = if ([IntPtr]::Size -eq 8) { 144 } else { 112 };
  $limits = [Runtime.InteropServices.Marshal]::AllocHGlobal($size);
  for ($i = 0; $i -lt $size; $i++) { [Runtime.InteropServices.Marshal]::WriteByte($limits, $i, 0) };
  [Runtime.InteropServices.Marshal]::WriteInt32($limits, 16, 0x2000);
  if (-not $native::SetInformationJobObject($job, 9, $limits, $size)) { throw 'SetInformationJobObject kill-on-close failed' };
  if (-not $native::AssignProcessToJobObject($job, $native::GetCurrentProcess())) { throw 'AssignProcessToJobObject failed' };
} catch {
  [Console]::Error.WriteLine('${WINDOWS_SHIM_JOB_FAILURE_MARKER}' + $_.Exception.Message);
  exit 127;
};
${invocation};
$cliExitCode = $LASTEXITCODE;
try {
  # Normal completion transfers detached descendants back to upstream ownership,
  # independently of the command's exit status. No breakaway is allowed while
  # the CLI is running. A release failure must retain forced-cleanup semantics.
  [Runtime.InteropServices.Marshal]::WriteInt32($limits, 16, 0);
  if (-not $native::SetInformationJobObject($job, 9, $limits, $size)) { throw 'SetInformationJobObject release failed' };
  [Runtime.InteropServices.Marshal]::FreeHGlobal($limits);
  [void]$native::CloseHandle($job);
} catch {
  [Console]::Error.WriteLine('${WINDOWS_SHIM_JOB_FAILURE_MARKER}' + $_.Exception.Message);
  exit 127;
};
exit $cliExitCode;
`.trim();
}
