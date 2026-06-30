import { useFormContext } from 'react-hook-form'
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, XCircle } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isValidCPF } from '@/lib/cpf'

interface FormInputProps {
  name: string
  label: string
  placeholder?: string
  type?: 'text' | 'email' | 'textarea' | 'select'
  options?: string[]
  mask?: 'cpf' | 'phone'
}

export function FormInput({
  name,
  label,
  placeholder,
  type = 'text',
  options,
  mask,
}: FormInputProps) {
  const {
    control,
    trigger,
    formState: { errors },
  } = useFormContext()
  const error = errors[name]

  const applyMask = (raw: string): string => {
    let val = raw
    if (mask === 'cpf') {
      val = val
        .replace(/\D/g, '')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})/, '$1-$2')
        .replace(/(-\d{2})\d+?$/, '$1')
    } else if (mask === 'phone') {
      val = val.replace(/\D/g, '')
      if (val.length <= 10) {
        val = val.replace(/^(\d{2})(\d)/g, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2')
      } else {
        val = val.replace(/^(\d{2})(\d)/g, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2')
      }
      val = val.substring(0, 15)
    }
    return val
  }

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        // Feedback ao vivo do CPF: só avalia quando os 11 dígitos foram digitados.
        const digits = mask === 'cpf' ? (field.value || '').replace(/\D/g, '') : ''
        const cpfState: boolean | null =
          mask === 'cpf' && digits.length === 11 ? isValidCPF(digits) : null
        const cpfBorder =
          cpfState === false
            ? 'border-red-500 focus-visible:ring-red-500'
            : cpfState === true
              ? 'border-emerald-500 focus-visible:ring-emerald-500'
              : ''

        return (
          <FormItem>
            <FormLabel className="text-foreground">{label}</FormLabel>
            <FormControl>
              {type === 'textarea' ? (
                <Textarea
                  placeholder={placeholder}
                  className={`resize-none bg-white ${error ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
                  {...field}
                />
              ) : type === 'select' ? (
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger
                      className={`bg-white ${error ? 'border-red-500 focus:ring-red-500' : ''}`}
                    >
                      <SelectValue placeholder={placeholder} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {options?.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="relative">
                  <Input
                    type={type}
                    placeholder={placeholder}
                    className={`bg-white ${cpfState !== null ? 'pr-9' : ''} ${
                      cpfBorder || (error ? 'border-red-500 focus-visible:ring-red-500' : '')
                    }`}
                    {...field}
                    onChange={(e) => {
                      const val = applyMask(e.target.value)
                      field.onChange(val)
                      // Ao completar/alterar o CPF, revalida na hora pra mostrar a mensagem.
                      if (mask === 'cpf') trigger(name)
                    }}
                  />
                  {cpfState === true && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  )}
                  {cpfState === false && (
                    <XCircle className="w-4 h-4 text-red-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  )}
                </div>
              )}
            </FormControl>
            <FormMessage />
          </FormItem>
        )
      }}
    />
  )
}
